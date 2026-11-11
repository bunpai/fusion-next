import { FusionRunId, type EffectRecord, type TransitionRecord, type WorktreeRecord } from '../lifecycle/index.js'
import type { RunManager } from '../run-manager/index.js'
import type { EffectLedger } from '../effects/ledger.js'
import type { TransitionService, TransitionOutcome, TransitionRequestSpec } from '../transition/service.js'
import type { CapabilityRequirements } from '../generation/service.js'

/** H03 multi-agent engineering integration and failure recovery.
 *
 * plan() is strictly read-only: recovery NEVER re-dispatches dangerous actions by itself. It
 * classifies what a restarted process may resume automatically (idempotent effects, journaled
 * transitions) versus what requires an operator/Lead decision (needs-verification or never-retry
 * effects, unresolved NEEDS_REPAIR states, worktrees awaiting cleanup). resumeTransition() only
 * continues a journaled transition using the spec captured in its own checkpoint marker — no step
 * is guessed, nothing is repeated outside the journal's idempotency envelope. */

export type ResumableTransition = {
  transitionId: string; agentId: string; mode: TransitionRecord['mode']
  fromGenerationId: string; toGenerationId: string
  nextAction: 'resume' | 'blocked'
  reason?: string
}

export type UnsettledEffectView = {
  effectId: string; effectClass: EffectRecord['effectClass']; state: EffectRecord['state']
  safeToAutoRetry: boolean; action: 'redispatch' | 'manual-verify' | 'manual-reconcile' | 'dispatch'
}

export type WorktreeCleanupView = { worktreeId: string; state: WorktreeRecord['state']; path: string }

export type RecoveryPlan = {
  runId: string
  runStatus: string
  resumableTransitions: ResumableTransition[]
  unsettledEffects: UnsettledEffectView[]
  worktreesNeedingCleanup: WorktreeCleanupView[]
  blockedReasons: string[]
}

export class RecoveryCoordinator {
  constructor(private readonly manager: RunManager, private readonly transitions: TransitionService) {}

  plan(runId: string): RecoveryPlan {
    const state = this.manager.getState()
    const run = state.runs[FusionRunId(runId)]
    if (!run) throw new Error(`NEEDS_REPAIR: run ${runId} unknown`)
    const resumableTransitions: ResumableTransition[] = []
    const unsettledEffects: UnsettledEffectView[] = []
    const worktreesNeedingCleanup: WorktreeCleanupView[] = []
    const blockedReasons: string[] = []

    for (const transition of Object.values(state.transitions)) {
      if (transition.runId !== run.id) continue
      if (transition.phase !== 'CHECKPOINTED') continue
      if (transition.toSpec) {
        resumableTransitions.push({ transitionId: transition.transitionId, agentId: transition.agentId,
          mode: transition.mode, fromGenerationId: transition.fromGenerationId,
          toGenerationId: transition.toGenerationId, nextAction: 'resume' })
      } else {
        resumableTransitions.push({ transitionId: transition.transitionId, agentId: transition.agentId,
          mode: transition.mode, fromGenerationId: transition.fromGenerationId,
          toGenerationId: transition.toGenerationId, nextAction: 'blocked',
          reason: 'checkpoint marker predates journaled target spec; manual reconstruction required' })
        blockedReasons.push(`transition ${transition.transitionId} lacks a journaled target spec`)
      }
    }

    for (const effect of Object.values(state.effects)) {
      if (effect.runId !== run.id) continue
      if (effect.state === 'SETTLED' || effect.state === 'DISCARDED') continue
      if (effect.state === 'INTENT') {
        unsettledEffects.push({ effectId: effect.effectId, effectClass: effect.effectClass,
          state: effect.state, safeToAutoRetry: true, action: 'dispatch' })
      } else if (effect.state === 'EXECUTING') {
        const safe = effect.effectClass === 'IDEMPOTENT'
        unsettledEffects.push({ effectId: effect.effectId, effectClass: effect.effectClass,
          state: effect.state, safeToAutoRetry: safe,
          action: safe ? 'redispatch' : (effect.effectClass === 'NEEDS_VERIFICATION' ? 'manual-verify' : 'manual-reconcile') })
        if (!safe) blockedReasons.push(`effect ${effect.effectId} (${effect.effectClass}) requires manual handling`)
      } else {
        unsettledEffects.push({ effectId: effect.effectId, effectClass: effect.effectClass,
          state: effect.state, safeToAutoRetry: false, action: 'manual-reconcile' })
        blockedReasons.push(`effect ${effect.effectId} is NEEDS_REPAIR and requires verified reconciliation`)
      }
    }

    for (const worktree of Object.values(state.worktrees)) {
      if (worktree.runId !== run.id) continue
      if (worktree.state === 'ACTIVE' || worktree.state === 'ROLLED_BACK') {
        worktreesNeedingCleanup.push({ worktreeId: worktree.worktreeId, state: worktree.state, path: worktree.path })
      }
    }

    return { runId, runStatus: run.status, resumableTransitions, unsettledEffects, worktreesNeedingCleanup, blockedReasons }
  }

  /** Resume one journaled transition. Requires the checkpoint marker to carry the target spec
   * (H03). Re-calling request() replays the completed prefix idempotently and never repeats a
   * committed or rolled-back transition. */
  resumeTransition(runId: string, transitionId: string): TransitionOutcome {
    const state = this.manager.getState()
    const record = state.transitions[transitionId]
    if (!record || record.runId !== FusionRunId(runId)) throw new Error(`NEEDS_REPAIR: transition ${transitionId} unknown for run ${runId}`)
    if (record.phase !== 'CHECKPOINTED') throw new Error(`NEEDS_REPAIR: transition ${transitionId} is ${record.phase}, not resumable`)
    if (!record.toSpec) throw new Error(`NEEDS_REPAIR: transition ${transitionId} has no journaled target spec; refusing to guess`)
    const spec = record.toSpec
    const request: TransitionRequestSpec = {
      transitionId,
      agentId: spec.agentId,
      mode: record.mode,
      fromGenerationId: record.fromGenerationId,
      to: { generationId: record.toGenerationId, sessionId: spec.sessionId,
        route: spec.route, requirements: spec.requirements as CapabilityRequirements },
    }
    return this.transitions.request(FusionRunId(runId), request)
  }
}
