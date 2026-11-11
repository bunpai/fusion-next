/** C01 minimal session lifecycle: capability-gated activation over the B03 journal. */
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'
import { SessionAliasId, type FusionRunId } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'
import { resolveOrCreateAlias, type AliasIntent } from './session-alias.js'

export interface ActivationOutcome {
  readonly runId: FusionRunId
  readonly created: boolean
  readonly resumed: boolean
  readonly alreadyActive: boolean
}

const conflict = (message: string): never => { throw new Error(`SESSION_LIFECYCLE_CONFLICT: ${message}`) }

/**
 * Activation is gated twice: session.inspect validates the report itself and
 * lifecycle.transition authorizes every state change before any mutation. rc2
 * and unknown Host versions are denied by the A04 fence, so activate() fails
 * closed without touching the journal. Creation and activation are two journal
 * events, each its own durable transaction: a crash between them leaves the run
 * durably ACTIVATING, and the next activate() resumes it idempotently. Event ids
 * are derived from the run id plus the per-run revision observed at read time,
 * so an exact retry collapses into the already-committed event while any other
 * interleaving fails the CAS instead of double-applying.
 */
export class SessionLifecycle {
  constructor(private readonly manager: RunManager, private readonly report: HostCapabilityReport) {}

  activate(hostSessionId: string, intent: AliasIntent): ActivationOutcome {
    requireHostOperation(this.report, 'session.inspect')
    requireHostOperation(this.report, 'lifecycle.transition')
    const sessionId = SessionAliasId(hostSessionId)
    const alias = this.manager.getAlias(sessionId)
    if (!alias) {
      if (intent.kind === 'restore') {
        throw new Error(`NEEDS_REPAIR: no Fusion session binding for host session ${hostSessionId}; refusing to fabricate a run`)
      }
      const resolution = resolveOrCreateAlias(this.manager, hostSessionId, intent)
      const run = this.manager.getRun(resolution.runId)
      if (!run) {
        // Explicit throw narrows `run` for the revision reads below.
        throw new Error(`NEEDS_REPAIR: run projection missing for ${resolution.runId}`)
      }
      this.append(this.activated(resolution.runId, sessionId, run.revision), run.revision)
      return { runId: resolution.runId, created: true, resumed: false, alreadyActive: false }
    }
    const run = this.manager.getRun(alias.runId)
    if (!run) {
      // Explicit throw narrows `run` for the status switch below.
      throw new Error(`NEEDS_REPAIR: session ${hostSessionId} is bound to missing run ${alias.runId}`)
    }
    switch (run.status) {
      case 'RUNNING':
        return { runId: run.id, created: false, resumed: false, alreadyActive: true }
      case 'ACTIVATING':
        if (run.restorePending) {
          this.append(this.restored(run.id, sessionId, run.revision), run.revision)
        } else {
          this.append(this.activated(run.id, sessionId, run.revision), run.revision)
        }
        return { runId: run.id, created: false, resumed: true, alreadyActive: false }
      case 'SUSPENDED':
        if (intent.kind === 'create') {
          conflict(`host session ${hostSessionId} is already bound to run ${run.id} in status SUSPENDED; use the restore intent`)
        }
        this.append(this.restoreRequested(run.id, sessionId, run.revision), run.revision)
        this.append(this.restored(run.id, sessionId, run.revision + 1), run.revision + 1)
        return { runId: run.id, created: false, resumed: true, alreadyActive: false }
      default:
        // conflict() never returns; the explicit return satisfies exhaustiveness.
        return conflict(`run ${run.id} in status ${run.status} cannot be activated`)
    }
  }

  private append(input: RunEventInput, expectedRevision: number): void { this.manager.append(input, expectedRevision) }

  private activated(runId: FusionRunId, sessionId: ReturnType<typeof SessionAliasId>, revision: number): RunEventInput {
    return { schemaVersion: 1, eventId: `fusion/activate/${runId}/r${revision}`, type: 'RUN_ACTIVATED', runId, hostSessionId: sessionId } as RunEventInput
  }
  private restoreRequested(runId: FusionRunId, sessionId: ReturnType<typeof SessionAliasId>, revision: number): RunEventInput {
    return { schemaVersion: 1, eventId: `fusion/restore-requested/${runId}/r${revision}`, type: 'RUN_RESTORE_REQUESTED', runId, hostSessionId: sessionId } as RunEventInput
  }
  private restored(runId: FusionRunId, sessionId: ReturnType<typeof SessionAliasId>, revision: number): RunEventInput {
    return { schemaVersion: 1, eventId: `fusion/restore/${runId}/r${revision}`, type: 'RUN_RESTORED', runId, hostSessionId: sessionId } as RunEventInput
  }
}
