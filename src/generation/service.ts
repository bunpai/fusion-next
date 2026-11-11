/** D02 Session Generation service: capability-checked preparation and stale-callback fencing.
 * Model switching (plan §4/T08/T09/T14/T17) is expressed as generation transitions over the B03
 * journal: a candidate route must be DECLARED capable for the pending requirements before any
 * journal event is appended, switches commit atomically (old RETIRED + new ACTIVE in one event),
 * and a callback from a generation that is no longer current is fenced by the reducer so a late
 * result can never commit into a new generation. External EFFECT receipts are deliberately NOT
 * fenced by generation: evidence of an external side effect must always be recorded. */
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'
import { AgentGenerationId, FusionRunId, type ModelRoute } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'

export interface CapabilityRequirements {
  readonly requireTools?: boolean
  readonly minContextTokens?: number
  /** Exact digest the run's task brief was frozen against; checked against the DECLARED capability. */
  readonly capabilityDigest?: string
}

export interface RouteCapability {
  readonly tools: boolean
  readonly contextWindow: number
  readonly capabilityDigest: string
}

const routeKey = (route: ModelRoute): string => `${route.provider}/${route.model}`

export class RouteCapabilityRegistry {
  private readonly declared = new Map<string, RouteCapability>()

  declare(provider: string, model: string, capability: RouteCapability): void {
    this.declared.set(`${provider}/${model}`, capability)
  }

  /** Non-throwing lookup used by the L01 legacy-menu mapping. */
  lookup(provider: string, model: string): RouteCapability | undefined {
    return this.declared.get(`${provider}/${model}`)
  }

  assertCapable(route: ModelRoute, required: CapabilityRequirements): void {
    const known = this.declared.get(routeKey(route))
    if (!known) throw new Error(`ROUTE_CAPABILITY_REJECTED: ${routeKey(route)} is not a declared capable route`)
    if (required.capabilityDigest !== undefined && known.capabilityDigest !== required.capabilityDigest) {
      throw new Error(`ROUTE_CAPABILITY_REJECTED: ${routeKey(route)} capability digest ${known.capabilityDigest} does not satisfy required ${required.capabilityDigest}`)
    }
    if (route.capabilityDigest !== known.capabilityDigest) {
      throw new Error(`ROUTE_CAPABILITY_REJECTED: route digest ${route.capabilityDigest} does not match declared capability ${known.capabilityDigest}`)
    }
    if (required.requireTools === true && !known.tools) {
      throw new Error(`ROUTE_CAPABILITY_REJECTED: ${routeKey(route)} does not support the required tool surface`)
    }
    if (required.minContextTokens !== undefined && known.contextWindow < required.minContextTokens) {
      throw new Error(`ROUTE_CAPABILITY_REJECTED: ${routeKey(route)} context window ${known.contextWindow} < required ${required.minContextTokens}`)
    }
  }
}

export class GenerationService {
  constructor(private readonly manager: RunManager, private readonly report: HostCapabilityReport,
    private readonly registry: RouteCapabilityRegistry) {}

  prepare(runId: FusionRunId, agentId: string, sessionId: string, generationId: AgentGenerationId,
    route: ModelRoute, requirements: CapabilityRequirements, options: { beforeCommit?: () => void } = {}): { generationId: AgentGenerationId; epoch: number } {
    requireHostOperation(this.report, 'lifecycle.transition')
    this.registry.assertCapable(route, requirements)
    const run = this.requireRun(runId)
    const epoch = this.nextEpoch(runId, agentId)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-prepared/${generationId}/r${run.revision}`,
      type: 'GENERATION_PREPARED', runId, generationId, agentId, sessionId, route, epoch } as RunEventInput,
      run.revision, options)
    return { generationId, epoch }
  }

  activate(runId: FusionRunId, generationId: AgentGenerationId): void {
    requireHostOperation(this.report, 'lifecycle.transition')
    const state = this.manager.getState()
    const gen = state.generations[generationId]
    const run = state.runs[runId]
    // A committed-but-unacknowledged activation must retry as a no-op (crash between append and ack).
    if (gen && run && gen.status === 'ACTIVE' && run.currentGenerationIds[gen.agentId] === generationId) return
    this.requireRun(runId)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-activated/${generationId}/r${run.revision}`,
      type: 'GENERATION_ACTIVATED', runId, generationId } as RunEventInput, run.revision)
  }

  /** Start draining the current generation before a switch; the run stays RUNNING. */
  drain(runId: FusionRunId, generationId: AgentGenerationId): void {
    requireHostOperation(this.report, 'lifecycle.transition')
    const run = this.requireRun(runId)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-draining/${generationId}/r${run.revision}`,
      type: 'GENERATION_DRAINING', runId, generationId } as RunEventInput, run.revision)
  }

  /** Abandon an uncommitted preparation (never current). */
  abortPreparation(runId: FusionRunId, generationId: AgentGenerationId): void {
    requireHostOperation(this.report, 'lifecycle.transition')
    const run = this.requireRun(runId)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-aborted/${generationId}/r${run.revision}`,
      type: 'GENERATION_PREPARATION_ABORTED', runId, generationId } as RunEventInput, run.revision)
  }

  /** Resume the still-current generation after a drain was started but the switch was abandoned. */
  cancelDrain(runId: FusionRunId, generationId: AgentGenerationId): void {
    requireHostOperation(this.report, 'lifecycle.transition')
    const run = this.requireRun(runId)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-drain-cancelled/${generationId}/r${run.revision}`,
      type: 'GENERATION_DRAIN_CANCELLED', runId, generationId } as RunEventInput, run.revision)
  }

  /** Atomic switch: drain current -> prepare replacement -> commit old+new in ONE journal event.
   * The switch event is the crash boundary: no intermediate state can persist with the old
   * generation already retired but the replacement not yet active. */
  switchGeneration(runId: FusionRunId, agentId: string, fromGenerationId: AgentGenerationId,
    to: { generationId: AgentGenerationId; sessionId: string; route: ModelRoute; requirements: CapabilityRequirements }): { from: AgentGenerationId; to: AgentGenerationId } {
    requireHostOperation(this.report, 'lifecycle.transition')
    this.registry.assertCapable(to.route, to.requirements)
    const run = this.requireRun(runId)
    const epoch = this.nextEpoch(runId, agentId)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-draining/${fromGenerationId}/r${run.revision}`,
      type: 'GENERATION_DRAINING', runId, generationId: fromGenerationId } as RunEventInput, run.revision)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-prepared/${to.generationId}/r${run.revision + 1}`,
      type: 'GENERATION_PREPARED', runId, generationId: to.generationId, agentId, sessionId: to.sessionId, route: to.route, epoch } as RunEventInput, run.revision + 1)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-switch/${fromGenerationId}/to-${to.generationId}/r${run.revision + 2}`,
      type: 'GENERATION_SWITCH_COMMITTED', runId, fromGenerationId, toGenerationId: to.generationId } as RunEventInput, run.revision + 2)
    return { from: fromGenerationId, to: to.generationId }
  }

  /** Commit-only step of a transition: atomically retires the drained source and activates the
   * prepared replacement in ONE journal event. Used by the D03 transition manager so the commit
   * step can crash and resume independently of the drain/prepare steps. */
  commitSwitch(runId: FusionRunId, fromGenerationId: AgentGenerationId, toGenerationId: AgentGenerationId): void {
    requireHostOperation(this.report, 'lifecycle.transition')
    const run = this.requireRun(runId)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-switch/${fromGenerationId}/to-${toGenerationId}/r${run.revision}`,
      type: 'GENERATION_SWITCH_COMMITTED', runId, fromGenerationId, toGenerationId } as RunEventInput, run.revision)
  }

  /** Tool/token callback delivery for the CURRENT generation; stale callbacks are fenced below. */
  callback(runId: FusionRunId, generationId: AgentGenerationId): void {
    requireHostOperation(this.report, 'lifecycle.transition')
    const run = this.requireRun(runId)
    this.append({ schemaVersion: 1, eventId: `fusion/generation-callback/${generationId}/r${run.revision}`,
      type: 'GENERATION_CALLBACK', runId, generationId } as RunEventInput, run.revision)
  }

  private nextEpoch(runId: FusionRunId, agentId: string): number {
    const max = Object.values(this.manager.getState().generations)
      .filter(g => g.runId === runId && g.agentId === agentId)
      .reduce((acc, g) => Math.max(acc, g.epoch), 0)
    return max + 1
  }

  private requireRun(runId: FusionRunId): NonNullable<ReturnType<RunManager['getRun']>> {
    const run = this.manager.getRun(runId)
    if (!run) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    return run
  }

  private append(input: RunEventInput, expectedRevision: number, options: { beforeCommit?: () => void } = {}): void {
    this.manager.append(input, expectedRevision, options)
  }
}
