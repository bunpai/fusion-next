/** C03 fork lineage with copy-on-write context and zero inherited authority.
 * A Fusion run fork creates a fresh run/task/budget/agent identity (plan §3): the branch starts
 * SUSPENDED, inherits NOTHING that grants authority (no approvals, no leases, no in-flight tool
 * requests), and only records the confirmed lineage boundary (forkPointSeq). A fork of an ordinary
 * (unbound) host session records nothing: the branch stays ordinary and may activate Fusion
 * independently through the C01 activation path. */
import { type HostCapabilityReport } from '../host-capabilities/index.js';
import { FusionRunId, SessionAliasId, type ModelRoute } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
export interface ForkSpec {
    /** New host session id for the branch (Host-provided, must not collide with an alias). */
    readonly hostSessionId: string;
    readonly branchId: string;
    /** Fresh identities; defaults derive from the source ids plus the branch id. */
    readonly taskId?: string;
    readonly budgetId?: string;
    readonly agentId?: string;
}
export interface ForkOutcome {
    /** false when the source session had no Fusion binding: the branch is an ordinary session. */
    readonly fused: boolean;
    readonly runId?: FusionRunId;
    readonly branchId?: string;
    /** Global journal seq boundary shared with the parent; later parent events never leak into the branch. */
    readonly forkPointSeq?: number;
    /** The branch may inherit the frozen menu choice as its INITIAL route intent (S10); it is only
     * a default: the branch's own generation must still be prepared and may differ (S11). */
    readonly inheritedRoute?: ModelRoute;
}
export declare class SessionFork {
    private readonly manager;
    private readonly report;
    constructor(manager: RunManager, report: HostCapabilityReport);
    fork(sourceHostSessionId: SessionAliasId, spec: ForkSpec): ForkOutcome;
    private currentRoute;
}
