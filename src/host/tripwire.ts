import { snapshotWorkspace, type WorkspaceSnapshot } from './workspace.js'
import { auditWorkspace } from './audit-v3.js'

/**
 * M5 (C2 tripwire): the catalog channel forwards a whole read-class turn to the
 * worker model with the session's unrestricted tool set — no lead-lane write
 * gate (pair mode denies writes via LEAD_LANE_TOOLS, catalog mode has no scope).
 * A worker-routed turn that writes files is therefore un-audited.
 *
 * This module latches a workspace snapshot when the catalog route forwards a
 * turn to the worker, settles a deterministic audit when the agent goes idle,
 * and — only on tripwire conditions — stashes an escalation notice that the
 * next turn injects after force-routing back to the lead.
 *
 * Tripwire conditions (deterministic, no judge):
 *   - deletedTestLines > 0  (Critical: existing test coverage was removed)
 *   - missingPromptLiterals (the user asked for a concrete artifact, absent)
 * A write turn that passes both checks stays un-escalated — the point of the
 * worker-primary channel is that honest small writes don't pay a lead tax.
 */

export interface TripwireAudit {
  changedFiles: readonly string[]
  unifiedDiff?: string
  staticAudits: {
    mutatedExistingTestFiles: readonly string[]
    deletedTestLines: number
    missingPromptLiterals: readonly string[]
  }
}

export interface TripwireDeps {
  snapshot(root: string): WorkspaceSnapshot | undefined
  audit(input: {
    root: string
    base: WorkspaceSnapshot | undefined
    candidate: WorkspaceSnapshot | undefined
    instruction: string
  }): Promise<TripwireAudit>
}

interface PendingForward {
  base: WorkspaceSnapshot
  userText: string
  root: string
  routedAt: number
}

export function tripwireBreached(audit: TripwireAudit): boolean {
  return audit.staticAudits.deletedTestLines > 0 || audit.staticAudits.missingPromptLiterals.length > 0
}

export function tripwireNoticeText(audit: TripwireAudit): string {
  return [
    '[fusion-next tripwire] The previous read-class turn was forwarded to the executor model and it modified the workspace. The deterministic audit flagged it, so this turn is routed back to you (the planner) for review.',
    'AuditBundle: ' + JSON.stringify({
      workerStatus: 'forwarded-turn',
      changedFiles: audit.changedFiles,
      staticAudits: audit.staticAudits,
      repairRounds: 0,
      note: 'Catalog-channel forwarded turn; no verify_commands ran. Review the flagged changes — revert, fix forward, or accept.',
    }),
  ].join('\n')
}

export class CatalogTripwire {
  private readonly pending = new Map<string, PendingForward>()
  private readonly notices = new Map<string, string>()
  constructor(private readonly deps: TripwireDeps) {}

  /** Latch a snapshot at the first worker-routed request of a turn. */
  latch(sessionId: string, root: string, userText: string): void {
    if (this.pending.has(sessionId) || this.notices.has(sessionId)) return
    const base = this.deps.snapshot(root)
    if (base) this.pending.set(sessionId, { base, userText, root, routedAt: Date.now() })
  }

  /** True while an escalation notice waits for the next turn → force lead route. */
  escalate(sessionId: string): boolean {
    return this.notices.has(sessionId)
  }

  /** Pop the notice for injection into the next forwarded request. */
  takeNotice(sessionId: string): string | undefined {
    const notice = this.notices.get(sessionId)
    if (notice !== undefined) this.notices.delete(sessionId)
    return notice
  }

  /**
   * Run the deferred audit when the agent goes idle. Writes the notice into
   * the escalation map on breach; returns it (or undefined when clean).
   */
  async settle(sessionId: string): Promise<string | undefined> {
    const forward = this.pending.get(sessionId)
    if (!forward) return undefined
    this.pending.delete(sessionId)
    const candidate = this.deps.snapshot(forward.root)
    let audit: TripwireAudit
    try {
      audit = await this.deps.audit({ root: forward.root, base: forward.base, candidate, instruction: forward.userText })
    } catch { return undefined }
    if (audit.changedFiles.length === 0 || !tripwireBreached(audit)) return undefined
    const notice = tripwireNoticeText(audit)
    this.notices.set(sessionId, notice)
    return notice
  }

  /** Drop all state for a session (dispose/clear). */
  clear(sessionId: string): void {
    this.pending.delete(sessionId)
    this.notices.delete(sessionId)
  }
}

export function createCatalogTripwire(): CatalogTripwire {
  return new CatalogTripwire({
    snapshot: root => snapshotWorkspace(root),
    audit: input => auditWorkspace(input),
  })
}
