import type { TaskId } from '../contracts.js';
import type { RunManager } from '../run-manager/index.js';
import type { SqliteFusionStore } from '../task/sqlite-store.js';
import type { ResolvedProfile } from '../profile/resolve.js';
/**
 * Mirrors legacy coordinator task events into the v2 lifecycle journal as a
 * SHADOW projection. The live control plane stays legacy; this journal gives
 * the B02+ reducer/projection machinery real runtime data without switching
 * the control path. Every append is fail-safe: a shadow failure never breaks
 * the live task, and re-emitted events collapse through deterministic ids.
 */
export declare class V2Shadow {
    private readonly manager;
    private readonly store;
    private readonly profile;
    private readonly briefs;
    private readonly assignmentsByWorkOrder;
    private readonly workerGenerationByAssignment;
    private readonly effectsByOperation;
    private readonly leadGenerations;
    private readonly warned;
    constructor(manager: RunManager, store: SqliteFusionStore, profile: () => ResolvedProfile | undefined);
    handle(taskId: TaskId, type: string, payload: unknown): void;
    private project;
    /** task/created carries parent:SessionId; the v2 run id follows fusionActivate's convention. */
    private runIdFor;
    private leadAgentFor;
    private append;
    /** Emit PREPARED+ACTIVATED for an agent once; later calls collapse through state checks. */
    private ensureGeneration;
    private workOrderPrepared;
    private effectDispatched;
    private effectSettled;
    private effectUnresolved;
    private reviseBrief;
    private scopeExpanded;
    private acceptanceAmended;
    private reportSubmitted;
    private reviewCompleted;
    private taskCompleted;
}
