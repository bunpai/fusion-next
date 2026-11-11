/** C03 fork lineage with copy-on-write context and zero inherited authority.
 * A Fusion run fork creates a fresh run/task/budget/agent identity (plan §3): the branch starts
 * SUSPENDED, inherits NOTHING that grants authority (no approvals, no leases, no in-flight tool
 * requests), and only records the confirmed lineage boundary (forkPointSeq). A fork of an ordinary
 * (unbound) host session records nothing: the branch stays ordinary and may activate Fusion
 * independently through the C01 activation path. */
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'
import { FusionRunId, SessionAliasId, type ModelRoute, type RunMode } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'

export interface ForkSpec {
  /** New host session id for the branch (Host-provided, must not collide with an alias). */
  readonly hostSessionId: string
  readonly branchId: string
  /** Fresh identities; defaults derive from the source ids plus the branch id. */
  readonly taskId?: string
  readonly budgetId?: string
  readonly agentId?: string
}

export interface ForkOutcome {
  /** false when the source session had no Fusion binding: the branch is an ordinary session. */
  readonly fused: boolean
  readonly runId?: FusionRunId
  readonly branchId?: string
  /** Global journal seq boundary shared with the parent; later parent events never leak into the branch. */
  readonly forkPointSeq?: number
  /** The branch may inherit the frozen menu choice as its INITIAL route intent (S10); it is only
   * a default: the branch's own generation must still be prepared and may differ (S11). */
  readonly inheritedRoute?: ModelRoute
}

const branchEventId = (branchId: string): string => `fusion/session-fork/${branchId}`

export class SessionFork {
  constructor(private readonly manager: RunManager, private readonly report: HostCapabilityReport) {}

  fork(sourceHostSessionId: SessionAliasId, spec: ForkSpec): ForkOutcome {
    requireHostOperation(this.report, 'session.inspect')
    requireHostOperation(this.report, 'session.fork')
    const source = this.manager.getAlias(sourceHostSessionId)
    if (!source) return { fused: false }
    const sourceRun = this.manager.getRun(source.runId)
    if (!sourceRun) throw new Error(`NEEDS_REPAIR: fork source ${source.runId} has no run projection`)
    if (!spec.branchId || spec.branchId.trim() === '' || spec.branchId.includes('\u0000')) {
      throw new TypeError('fork branchId must be a non-empty string without NUL')
    }
    const state = this.manager.getState()
    const targetSession = SessionAliasId(spec.hostSessionId)
    if (state.aliases[targetSession]) {
      throw new Error(`SESSION_FORK_CONFLICT: host session ${spec.hostSessionId} already has a Fusion binding`)
    }
    const taskId = spec.taskId ?? `${sourceRun.taskId}#${spec.branchId}`
    const budgetId = spec.budgetId ?? `${sourceRun.budgetId}#${spec.branchId}`
    const agentId = spec.agentId ?? `agent-${spec.branchId}`
    const forkPointSeq = state.seq
    const runId = FusionRunId(`fusion-run-${spec.hostSessionId}`)
    const input = { schemaVersion: 1, eventId: branchEventId(spec.branchId), type: 'SESSION_FORKED' as const,
      runId, hostSessionId: targetSession, sourceRunId: source.runId, sourceHostSessionId: sourceHostSessionId,
      branchId: spec.branchId, forkPointSeq, taskId, budgetId, agentId, mode: sourceRun.mode as RunMode }
    // The branch run is fresh: its per-run CAS revision starts at 0.
    this.manager.append(input as RunEventInput, 0)
    return { fused: true, runId, branchId: spec.branchId, forkPointSeq, inheritedRoute: this.currentRoute(source.runId) }
  }

  private currentRoute(runId: FusionRunId): ModelRoute | undefined {
    const state = this.manager.getState()
    const run = state.runs[runId]
    if (!run) return undefined
    const generationIds = Object.values(run.currentGenerationIds)
    if (generationIds.length !== 1) return undefined
    return state.generations[generationIds[0]]?.route
  }
}
