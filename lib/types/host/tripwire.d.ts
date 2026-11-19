import { type WorkspaceSnapshot } from './workspace.js';
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
    changedFiles: readonly string[];
    unifiedDiff?: string;
    staticAudits: {
        mutatedExistingTestFiles: readonly string[];
        deletedTestLines: number;
        missingPromptLiterals: readonly string[];
    };
}
export interface TripwireDeps {
    snapshot(root: string): WorkspaceSnapshot | undefined;
    audit(input: {
        root: string;
        base: WorkspaceSnapshot | undefined;
        candidate: WorkspaceSnapshot | undefined;
        instruction: string;
    }): Promise<TripwireAudit>;
}
export declare function tripwireBreached(audit: TripwireAudit): boolean;
export declare function tripwireNoticeText(audit: TripwireAudit): string;
export declare class CatalogTripwire {
    private readonly deps;
    private readonly pending;
    private readonly notices;
    constructor(deps: TripwireDeps);
    /** Latch a snapshot at the first worker-routed request of a turn. */
    latch(sessionId: string, root: string, userText: string): void;
    /** True while an escalation notice waits for the next turn → force lead route. */
    escalate(sessionId: string): boolean;
    /** Pop the notice for injection into the next forwarded request. */
    takeNotice(sessionId: string): string | undefined;
    /**
     * Run the deferred audit when the agent goes idle. Writes the notice into
     * the escalation map on breach; returns it (or undefined when clean).
     */
    settle(sessionId: string): Promise<string | undefined>;
    /** Drop all state for a session (dispose/clear). */
    clear(sessionId: string): void;
}
export declare function createCatalogTripwire(): CatalogTripwire;
