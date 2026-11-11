import type { RunEventInput, RunManager } from '../run-manager/index.js'
import { FusionRunId, type AgentGenerationId, type TransitionMode } from '../lifecycle/index.js'
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type CapabilityRequirements } from '../generation/service.js'
import type { EffectLedger } from '../effects/ledger.js'
import type { ModelRoute } from '../lifecycle/index.js'

/** D03 transition manager.
 *
 * Orchestrates a model/agent generation switch as explicit, individually crash-safe steps:
 * VALIDATE (pure checks, no events) -> CHECKPOINT (durable intent marker) -> QUIESCE (drain the
 * effect ledger) -> PREPARE (drain old generation, prepare replacement) -> COMMIT (single atomic
 * switch event) with ROLLBACK and REPAIR as first-class outcomes.
 *
 * Every step is an appended lifecycle event, so a crash at ANY step leaves a journal that a fresh
 * process replays into exactly the completed prefix; re-calling request() resumes idempotently.
 * Capability failures reject BEFORE any event (the old run is untouched). Unsettled effects force
 * REPAIR_REQUIRED and are never auto-retried (plan §8/Q08). */
export type TransitionPhase = 'VALIDATED' | 'QUIESCED' | 'CHECKPOINTED' | 'PREPARED' | 'COMMITTED' | 'ROLLED_BACK'

export type TransitionRequestSpec = {
  transitionId: string
  agentId: string
  mode: TransitionMode
  fromGenerationId: AgentGenerationId
  to: { generationId: AgentGenerationId; sessionId: string; route: ModelRoute; requirements: CapabilityRequirements }
}

export type TransitionOptions = { crashAfter?: 'checkpoint' | 'prepare' }

export type TransitionOutcome =
  | { outcome: 'COMMITTED'; runId: FusionRunId; toGenerationId: AgentGenerationId; phases: TransitionPhase[]; resumed?: boolean }
  | { outcome: 'ROLLED_BACK'; runId: FusionRunId; fromGenerationId: AgentGenerationId; reason: string; phases: TransitionPhase[] }
  | { outcome: 'REJECTED'; runId: FusionRunId; reason: string }
  | { outcome: 'REPAIR_REQUIRED'; runId: FusionRunId; phases: TransitionPhase[]; blockers: string[] }

const UNSETTLED = new Set(['INTENT', 'EXECUTING', 'NEEDS_REPAIR'])

export class TransitionService {
  constructor(private readonly manager: RunManager, private readonly report: HostCapabilityReport,
    private readonly generations: GenerationService, private readonly ledger: EffectLedger,
    private readonly registry: RouteCapabilityRegistry) {}

  request(runId: FusionRunId, spec: TransitionRequestSpec, options: TransitionOptions = {}): TransitionOutcome {
    requireHostOperation(this.report, 'lifecycle.transition')
    if (spec.transitionId.length === 0 || spec.transitionId.includes('\u0000')) throw new TypeError('transitionId must be a non-empty string without NUL')

    const state = this.manager.getState()
    const run = state.runs[runId]
    if (!run) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    const existing = state.transitions[spec.transitionId]

    if (existing) {
      // A transition id names exactly one intent; re-use with a different intent is a conflict.
      const same = existing.agentId === spec.agentId && existing.mode === spec.mode &&
        existing.fromGenerationId === spec.fromGenerationId && existing.toGenerationId === spec.to.generationId
      if (!same) throw new Error(`TRANSITION_CONFLICT: transition id ${spec.transitionId} is already used by a different transition`)
      if (existing.phase === 'ROLLED_BACK') throw new Error(`TRANSITION_CONFLICT: transition ${spec.transitionId} already rolled back; use a new transition id`)
      if (existing.phase === 'COMMITTED') {
        const to = state.generations[existing.toGenerationId]
        if (to && to.status === 'ACTIVE' && run.currentGenerationIds[existing.agentId] === existing.toGenerationId) {
          return { outcome: 'COMMITTED', runId, toGenerationId: existing.toGenerationId, phases: [], resumed: true }
        }
        throw new Error(`TRANSITION_CONFLICT: transition ${spec.transitionId} committed but its replacement is not current`)
      }
    }

    // VALIDATE — capability failures reject before any event; the old run stays untouched.
    try {
      this.registry.assertCapable(spec.to.route, spec.to.requirements)
    } catch (error) {
      return { outcome: 'REJECTED', runId, reason: error instanceof Error ? error.message : String(error) }
    }

    // REPAIR — unsettled effects make the run un-switchable (fail-closed, visible, no auto-retry).
    const blockers = Object.values(state.effects)
      .filter(effect => effect.runId === runId && UNSETTLED.has(effect.state))
      .map(effect => `effects:${effect.effectId}:${effect.state}`)
    if (blockers.length > 0) return { outcome: 'REPAIR_REQUIRED', runId, phases: [], blockers }

    // CHECKPOINT — the durable intent marker; journaled before any generation mutation.
    if (!existing) {
      this.appendEvent(runId, { schemaVersion: 1, eventId: `fusion/transition/${spec.transitionId}/checkpointed`,
        type: 'TRANSITION_CHECKPOINTED', runId, transitionId: spec.transitionId, agentId: spec.agentId,
        mode: spec.mode, fromGenerationId: spec.fromGenerationId, toGenerationId: spec.to.generationId } as RunEventInput)
    }
    if (options.crashAfter === 'checkpoint') {
      throw new Error(`injected crash after transition checkpoint (transition ${spec.transitionId})`)
    }

    try {
      // QUIESCE — settle the effect ledger (the check above already saw zero unsettled effects;
      // drain re-validates under the latest committed state and throws EFFECT_DRAIN_BLOCKED on a race).
      this.ledger.drain(runId)

      // PREPARE — drain the current generation, then prepare the replacement (resumable: each
      // step is skipped when the journal already shows it done).
      const fresh = this.manager.getState()
      const fromGen = fresh.generations[spec.fromGenerationId]
      const toGen = fresh.generations[spec.to.generationId]
      const runNow = fresh.runs[runId]
      if (fromGen && fromGen.status === 'RETIRED') {
        // The switch already committed (crash between switch and marker finalize): only the
        // marker finalize remains; anything else is an unrecoverable inconsistency.
        if (!(toGen && toGen.status === 'ACTIVE' && runNow && runNow.currentGenerationIds[spec.agentId] === spec.to.generationId)) {
          throw new Error(`TRANSITION_CONFLICT: source generation ${spec.fromGenerationId} retired without a current replacement`)
        }
      } else {
        if (fromGen && fromGen.status === 'ACTIVE') this.generations.drain(runId, spec.fromGenerationId)
        if (toGen === undefined || toGen.status === 'RETIRED') {
          // A RETIRED target id fails reducer validation; that failure is a real rollback case.
          this.generations.prepare(runId, spec.agentId, spec.to.sessionId, spec.to.generationId, spec.to.route, spec.to.requirements)
        }
      }
      if (options.crashAfter === 'prepare') {
        throw new Error(`injected crash after generation prepare (transition ${spec.transitionId})`)
      }

      // COMMIT — one atomic event: old RETIRED + new ACTIVE + current remap; then finalize the marker.
      if (!(fromGen && fromGen.status === 'RETIRED')) {
        this.generations.commitSwitch(runId, spec.fromGenerationId, spec.to.generationId)
      }
      this.appendEvent(runId, { schemaVersion: 1, eventId: `fusion/transition/${spec.transitionId}/committed`,
        type: 'TRANSITION_COMMITTED', runId, transitionId: spec.transitionId } as RunEventInput)
      return { outcome: 'COMMITTED', runId, toGenerationId: spec.to.generationId,
        phases: ['VALIDATED', 'QUIESCED', 'CHECKPOINTED', 'PREPARED', 'COMMITTED'] }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      // An injected crash simulates process death: no rollback may run after it.
      if (reason.startsWith('injected crash')) throw error
      // ROLLBACK — restore the old generation and journal the failure; never leaves the run
      // without an ACTIVE current generation when the switch did not commit.
      const rolled = this.rollback(runId, spec, reason)
      if (rolled) {
        return { outcome: 'ROLLED_BACK', runId, fromGenerationId: spec.fromGenerationId, reason,
          phases: ['VALIDATED', 'CHECKPOINTED', 'ROLLED_BACK'] }
      }
      throw error
    }
  }

  private rollback(runId: FusionRunId, spec: TransitionRequestSpec, reason: string): boolean {
    try {
      const state = this.manager.getState()
      const toGen = state.generations[spec.to.generationId]
      if (toGen && toGen.status === 'PREPARING') this.generations.abortPreparation(runId, spec.to.generationId)
      const after = this.manager.getState()
      const fromGen = after.generations[spec.fromGenerationId]
      const stillPreparing = Object.values(after.generations)
        .some(g => g.runId === runId && g.agentId === spec.agentId && g.status === 'PREPARING')
      if (fromGen && fromGen.status === 'DRAINING' && !stillPreparing) this.generations.cancelDrain(runId, spec.fromGenerationId)
      this.appendEvent(runId, { schemaVersion: 1, eventId: `fusion/transition/${spec.transitionId}/rolled-back`,
        type: 'TRANSITION_ROLLED_BACK', runId, transitionId: spec.transitionId, error: reason } as RunEventInput)
      return true
    } catch {
      return false
    }
  }

  private appendEvent(runId: FusionRunId, input: RunEventInput): void {
    const run = this.manager.getRun(runId)
    if (!run) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    this.manager.append(input, run.revision)
  }
}
