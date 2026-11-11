import { type AssignmentRecord } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
import type { AgentManager } from '../agents/index.js';
import type { IndependentVerifier } from '../verification/index.js';
import type { BudgetService } from '../budget/index.js';
import { type HostCapabilityReport } from '../host-capabilities/index.js';
/** I02 shadow-review feedback, graded rework and Lead arbitration.
 *
 * Failure triage maps report severity to rework tiers: MINOR/MAJOR are ordered directly with
 * additive constraints (nothing is ever dropped from a brief), BLOCKER requires an explicit Lead
 * arbitration ruling first. Rework has a budget upper bound, and previously verified requirements
 * must never regress silently — assertNoRegression fails closed. */
export type ReworkTier = 'MINOR' | 'MAJOR' | 'BLOCKER';
export type ArbitrationRuling = 'REWORK' | 'ACCEPT' | 'ESCALATE';
export type TriageVerdict = {
    verdict: 'RISK';
    severity?: 'LOW' | 'MEDIUM' | 'HIGH';
    findings: string[];
};
export type TriageOutcome = {
    tier: ReworkTier;
    ordered: true;
    briefRevision: number;
} | {
    tier: ReworkTier;
    ordered: false;
    requiresArbitration: true;
};
export declare class ReworkCoordinator {
    private readonly manager;
    private readonly agents;
    private readonly verifier;
    private readonly budgets?;
    private readonly capabilityReport?;
    constructor(manager: RunManager, agents: AgentManager, verifier: IndependentVerifier, budgets?: BudgetService | undefined, capabilityReport?: HostCapabilityReport | undefined);
    triage(runId: string, assignmentId: string, input: TriageVerdict): TriageOutcome;
    orderRework(runId: string, assignmentId: string, tier: ReworkTier, addedConstraints: string[], budget?: {
        budgetId: string;
        estimatedCostMicros: number;
    }): AssignmentRecord;
    arbitrate(runId: string, assignmentId: string, arbiterGenerationId: string, ruling: ArbitrationRuling, reason: string): AssignmentRecord;
    /** Previously verified requirements must still be verified; a silent regression fails closed. */
    assertNoRegression(runId: string, requirementIds: readonly string[]): void;
    private gate;
    private currentRevision;
    private append;
}
