import { type ModelRoute, type RunStatus } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
/** K02 live monitor read-models: the state-refresh, event-replay and recovery-interaction layer
 * of the run UI. Everything here is a pure projection over the journal — the real React surface
 * needs the Host runtime, so the views and guards stay deterministic and testable. Recovering
 * runs are never rendered as normally executing and risky user actions are gated while
 * recovery is in progress. */
export type RunView = {
    runId: string;
    status: RunStatus;
    task: string;
    mode: string;
    branchId?: string;
    currentGenerationId?: string;
    generations: Array<{
        id: string;
        agentId: string;
        epoch: number;
        status: string;
        route: ModelRoute;
    }>;
    agents: readonly string[];
    lineage?: {
        parentRunId?: string;
        forkPointSeq?: number;
    };
    unsettledEffects: string[];
    pendingApprovals: number;
    activeLeases: number;
};
export type BranchSummary = {
    branchId: string;
    parentBranchId?: string;
    forkPointSeq?: number;
};
export type RenderState = {
    runId: string;
    displayStatus: 'RUNNING' | 'SUSPENDED' | 'RECOVERING' | 'NEEDS_REPAIR' | 'STOPPED' | 'WAITING';
    isRecovering: boolean;
};
export type UserAction = 'pause' | 'resume' | 'switch-model' | 'approve-budget' | 'view-effects' | 'replay-events';
export declare class LiveMonitor {
    private readonly manager;
    constructor(manager: RunManager);
    private requireRun;
    runView(runId: string): RunView;
    /** History/branch view: every known branch with its fork point, deterministically ordered. */
    branchView(): BranchSummary[];
    /** Replayable progress: journaled events from a durable cursor (at-least-once). */
    replayFrom(cursor: number, limit?: number): {
        events: import("../run-manager/index.js").JournalEvent[];
    };
    /** Transition/recovery view: journaled transition markers plus what still blocks switching. */
    transitionProgress(runId: string): {
        transitions: Array<{
            id: string;
            phase: string;
            error?: string;
        }>;
        blockedByEffects: string[];
    };
    renderState(runId: string): RenderState;
    /** Safe user interaction gate: while a run is recovering, only passive actions are allowed. */
    assertUserActionAllowed(runId: string, action: UserAction): boolean;
}
