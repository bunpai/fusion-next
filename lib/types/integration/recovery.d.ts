import { type EffectRecord, type TransitionRecord, type WorktreeRecord } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
import type { TransitionService, TransitionOutcome } from '../transition/service.js';
/** H03 multi-agent engineering integration and failure recovery.
 *
 * plan() is strictly read-only: recovery NEVER re-dispatches dangerous actions by itself. It
 * classifies what a restarted process may resume automatically (idempotent effects, journaled
 * transitions) versus what requires an operator/Lead decision (needs-verification or never-retry
 * effects, unresolved NEEDS_REPAIR states, worktrees awaiting cleanup). resumeTransition() only
 * continues a journaled transition using the spec captured in its own checkpoint marker — no step
 * is guessed, nothing is repeated outside the journal's idempotency envelope. */
export type ResumableTransition = {
    transitionId: string;
    agentId: string;
    mode: TransitionRecord['mode'];
    fromGenerationId: string;
    toGenerationId: string;
    nextAction: 'resume' | 'blocked';
    reason?: string;
};
export type UnsettledEffectView = {
    effectId: string;
    effectClass: EffectRecord['effectClass'];
    state: EffectRecord['state'];
    safeToAutoRetry: boolean;
    action: 'redispatch' | 'manual-verify' | 'manual-reconcile' | 'dispatch';
};
export type WorktreeCleanupView = {
    worktreeId: string;
    state: WorktreeRecord['state'];
    path: string;
};
export type RecoveryPlan = {
    runId: string;
    runStatus: string;
    resumableTransitions: ResumableTransition[];
    unsettledEffects: UnsettledEffectView[];
    worktreesNeedingCleanup: WorktreeCleanupView[];
    blockedReasons: string[];
};
export declare class RecoveryCoordinator {
    private readonly manager;
    private readonly transitions;
    constructor(manager: RunManager, transitions: TransitionService);
    plan(runId: string): RecoveryPlan;
    /** Resume one journaled transition. Requires the checkpoint marker to carry the target spec
     * (H03). Re-calling request() replays the completed prefix idempotently and never repeats a
     * committed or rolled-back transition. */
    resumeTransition(runId: string, transitionId: string): TransitionOutcome;
}
