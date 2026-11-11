import type { RunManager } from '../run-manager/index.js';
import type { AgentManager } from '../agents/index.js';
import type { RoleManager } from '../agents/roles.js';
import { type DelegationStats } from '../lifecycle/index.js';
export type DelegationInput = {
    directCostMicros: number;
    delegateWorkerCostMicros: number;
    coordinationCostMicros: number;
    reviewCostMicros: number;
    /** Parallelism credit: an effective speedup of N divides the worker cost by N. */
    parallelSpeedup?: number;
    budgetRemainingMicros?: number;
    recentFailures?: number;
    failureThreshold?: number;
};
export type DelegationDecision = {
    mode: 'DIRECT' | 'DELEGATE';
    netBenefitMicros: number;
    reasons: string[];
};
export type DelegationFeedback = {
    verdict: 'CLEAN' | 'RISK';
    severity?: 'LOW' | 'MEDIUM' | 'HIGH';
    findings: string[];
};
/** G03 value-of-delegation with an adaptive-brief feedback loop.
 *
 * `advise` is pure and deterministic (plan: 相同输入确定性选择): delegation wins only when its
 * projected net value is strictly positive AND the budget can fund it AND recent delegation
 * failures have not tripped the fallback gate (委派负收益时 Direct). `applyFeedback` folds shadow
 * review findings back into the assignment brief additively — existing constraints are never
 * dropped (约束不丢失). Outcomes are journaled as per-mode statistics. */
export declare class DelegationAdvisor {
    private readonly manager;
    private readonly agents;
    private readonly roles?;
    constructor(manager: RunManager, agents: AgentManager, roles?: RoleManager | undefined);
    advise(input: DelegationInput): DelegationDecision;
    recordOutcome(runId: string, assignmentId: string, mode: 'DIRECT' | 'DELEGATE', costMicros: number, verdict: 'COMPLETED' | 'FAILED'): void;
    stats(): {
        DIRECT: DelegationStats;
        DELEGATE: DelegationStats;
    };
    applyFeedback(runId: string, assignmentId: string, feedback: DelegationFeedback): {
        briefRevision: number;
        escalated: boolean;
    };
    private currentBriefRevision;
    private currentObjective;
    /** Without a RoleManager, fold the constraint directly through the journal (still additive). */
    private adaptBriefFallback;
    private append;
}
