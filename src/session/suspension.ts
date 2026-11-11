/** C02 safe Fusion<->ordinary model suspend/resume with visible abnormal state.
 * Suspending a Fusion run before switching the host session to an ordinary model is only allowed
 * from a quiescent state: no pending approvals, no active write leases, no unsettled effects
 * (D01 drain barrier). Blocked suspends are REPORTED, never forced; abnormal states stay visible
 * through view() so a GUI can render exactly why a switch is unsafe. */
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'
import { SessionAliasId, type EffectRecord, type FusionRunId, type RunStatus } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'
import type { EffectLedger } from '../effects/ledger.js'
import { SessionLifecycle, type ActivationOutcome } from './lifecycle.js'

const ABNORMAL_STATUSES: readonly RunStatus[] = ['NEEDS_REPAIR', 'WAITING_APPROVAL', 'WAITING_PROVIDER', 'VERIFYING']

export interface SuspendOutcome {
  readonly runId?: FusionRunId
  readonly bound: boolean
  readonly suspended: boolean
  readonly alreadySuspended: boolean
  readonly blockers: readonly string[]
}

export interface SessionStateView {
  readonly hostSessionId: SessionAliasId
  readonly bound: boolean
  readonly runId?: FusionRunId
  readonly status?: RunStatus
  readonly abnormal: boolean
  readonly blockers: readonly string[]
}

export class SessionSuspension {
  constructor(private readonly manager: RunManager, private readonly ledger: EffectLedger,
    private readonly report: HostCapabilityReport, private readonly lifecycle: SessionLifecycle) {}

  suspend(hostSessionId: SessionAliasId): SuspendOutcome {
    requireHostOperation(this.report, 'lifecycle.transition')
    const alias = this.manager.getAlias(hostSessionId)
    if (!alias) return { bound: false, suspended: false, alreadySuspended: false, blockers: [] }
    const run = this.manager.getRun(alias.runId)
    if (!run) return { runId: alias.runId, bound: true, suspended: false, alreadySuspended: false, blockers: ['run:missing'] }
    if (run.status === 'SUSPENDED') return { runId: run.id, bound: true, suspended: false, alreadySuspended: true, blockers: [] }
    const blockers = collectBlockers(run.status, run.pendingApprovalIds.length, run.activeLeaseIds.length,
      this.ledger.list(run.id))
    if (blockers.length > 0) return { runId: run.id, bound: true, suspended: false, alreadySuspended: false, blockers }
    const revision = run.revision
    this.manager.append({ schemaVersion: 1, eventId: `fusion/suspend-requested/${run.id}/r${revision}`,
      type: 'RUN_SUSPEND_REQUESTED', runId: run.id } as RunEventInput, revision)
    this.manager.append({ schemaVersion: 1, eventId: `fusion/suspended/${run.id}/r${revision + 1}`,
      type: 'RUN_SUSPENDED', runId: run.id } as RunEventInput, revision + 1)
    return { runId: run.id, bound: true, suspended: true, alreadySuspended: false, blockers: [] }
  }

  /** Resume delegates to the C01 activation path (restore intent) so gate + idempotency match.
   * The gate runs HERE as well: a denied report must never reach the delegated mutation. */
  resume(hostSessionId: SessionAliasId): ActivationOutcome {
    requireHostOperation(this.report, 'lifecycle.transition')
    return this.lifecycle.activate(hostSessionId, { kind: 'restore' })
  }

  view(hostSessionId: SessionAliasId): SessionStateView {
    const alias = this.manager.getAlias(hostSessionId)
    if (!alias) return { hostSessionId, bound: false, abnormal: false, blockers: [] }
    const run = this.manager.getRun(alias.runId)
    if (!run) return { hostSessionId, bound: true, runId: alias.runId, abnormal: true, blockers: ['run:missing'] }
    const blockers = collectBlockers(run.status, run.pendingApprovalIds.length, run.activeLeaseIds.length,
      this.ledger.list(run.id))
    return { hostSessionId, bound: true, runId: run.id, status: run.status,
      abnormal: blockers.length > 0 || ABNORMAL_STATUSES.includes(run.status), blockers }
  }
}

export function collectBlockers(status: RunStatus, approvals: number, leases: number, effects: readonly EffectRecord[]): string[] {
  const blockers: string[] = []
  if (status !== 'RUNNING' && status !== 'SUSPENDED') blockers.push(`status:${status}`)
  if (approvals > 0) blockers.push(`approvals:${approvals}`)
  if (leases > 0) blockers.push(`leases:${leases}`)
  for (const effect of effects) if (effect.state !== 'SETTLED' && effect.state !== 'DISCARDED') blockers.push(`effects:${effect.effectId}:${effect.state}`)
  return blockers
}
