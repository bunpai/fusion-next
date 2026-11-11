/** B01 domain-only event projection. No Host event subscriptions, storage, effects, or IO. */
import type { Brand } from '../contracts.js';
export type FusionRunId = Brand<string, 'FusionRunId'>;
export type AgentGenerationId = Brand<string, 'AgentGenerationId'>;
export type SessionAliasId = Brand<string, 'SessionAliasId'>;
export declare const FusionRunId: (value: string) => FusionRunId;
export declare const AgentGenerationId: (value: string) => AgentGenerationId;
export declare const SessionAliasId: (value: string) => SessionAliasId;
export type RunMode = 'DIRECT' | 'DELEGATE' | 'PARALLEL' | 'TAKEOVER';
export type RunStatus = 'ACTIVATING' | 'RUNNING' | 'SUSPENDING' | 'SUSPENDED' | 'VERIFYING' | 'WAITING_APPROVAL' | 'WAITING_PROVIDER' | 'NEEDS_REPAIR' | 'COMPLETED_SUCCESS' | 'COMPLETED_FAILURE' | 'CANCELLED' | 'BUDGET_STOPPED';
export interface ModelRoute {
    provider: string;
    model: string;
    reasoningEffort?: string;
    capabilityDigest: string;
}
export interface FusionRun {
    id: FusionRunId;
    hostSessionId: SessionAliasId;
    branchId?: string;
    taskId: string;
    mode: RunMode;
    status: RunStatus;
    revision: number;
    budgetId: string;
    agentIds: readonly string[];
    /** Compatibility projection for a single current generation; do not use for parallel ownership. */
    currentGenerationId?: AgentGenerationId;
    currentGenerationIds: Readonly<Record<string, AgentGenerationId>>;
    createdSeq: number;
    pendingApprovalIds: readonly string[];
    activeLeaseIds: readonly string[];
    restorePending?: boolean;
    hasActivated: boolean;
}
export interface AgentGeneration {
    id: AgentGenerationId;
    runId: FusionRunId;
    agentId: string;
    sessionId: string;
    route: ModelRoute;
    epoch: number;
    status: 'PREPARING' | 'ACTIVE' | 'DRAINING' | 'RETIRED';
}
export interface SessionAlias {
    hostSessionId: SessionAliasId;
    runId: FusionRunId;
    branchId?: string;
    forkPointSeq?: number;
    selectionStatus: 'INACTIVE' | 'ACTIVE' | 'SUSPENDING';
    revision: number;
}
export interface BranchLineage {
    branchId: string;
    parentBranchId?: string;
    parentRunId: FusionRunId;
    forkPointSeq: number;
}
/** Normalized internal session signals for a future adapter (not Host SDK hooks). */
export type SessionLifecycleSignal = {
    readonly schemaVersion: 1;
    readonly eventId: string;
} & ({
    type: 'SESSION_CREATED' | 'SESSION_OPENED' | 'SESSION_DETACHED' | 'SESSION_RESTORED' | 'SESSION_CLOSED';
    hostSessionId: SessionAliasId;
} | {
    type: 'SESSION_FORKED';
    sourceSessionId: SessionAliasId;
    targetSessionId: SessionAliasId;
    forkPointSeq: number;
} | {
    type: 'MODEL_SELECTION_CHANGED';
    hostSessionId: SessionAliasId;
    selection: 'FUSION' | 'ORDINARY';
});
type Created = {
    type: 'RUN_CREATED';
    runId: FusionRunId;
    hostSessionId: SessionAliasId;
    taskId: string;
    budgetId: string;
    branchId?: string;
    mode: RunMode;
};
type Forked = {
    type: 'SESSION_FORKED';
    runId: FusionRunId;
    hostSessionId: SessionAliasId;
    sourceRunId: FusionRunId;
    sourceHostSessionId: SessionAliasId;
    branchId: string;
    forkPointSeq: number;
    taskId: string;
    budgetId: string;
    agentId: string;
    mode: RunMode;
};
type Bound = {
    type: 'RUN_ACTIVATED' | 'RUN_RESTORE_REQUESTED' | 'RUN_RESTORED';
    runId: FusionRunId;
    hostSessionId: SessionAliasId;
};
type RunChange = {
    type: 'RUN_SUSPEND_REQUESTED' | 'RUN_SUSPENDED';
    runId: FusionRunId;
};
type Prepared = {
    type: 'GENERATION_PREPARED';
    runId: FusionRunId;
    generationId: AgentGenerationId;
    agentId: string;
    sessionId: string;
    route: ModelRoute;
    epoch: number;
};
type SwitchCommitted = {
    type: 'GENERATION_SWITCH_COMMITTED';
    runId: FusionRunId;
    fromGenerationId: AgentGenerationId;
    toGenerationId: AgentGenerationId;
};
type GenerationChange = {
    type: 'GENERATION_ACTIVATED' | 'GENERATION_DRAINING' | 'GENERATION_RETIRED' | 'GENERATION_CALLBACK' | 'GENERATION_PREPARATION_ABORTED' | 'GENERATION_DRAIN_CANCELLED';
    runId: FusionRunId;
    generationId: AgentGenerationId;
};
/** D01 effect idempotency classes: safe auto-retry, verify-before-retry, never auto-retry. */
export type EffectClass = 'IDEMPOTENT' | 'NEEDS_VERIFICATION' | 'NEVER_RETRY';
export type EffectState = 'INTENT' | 'EXECUTING' | 'SETTLED' | 'NEEDS_REPAIR' | 'DISCARDED';
export interface EffectRecord {
    readonly effectId: string;
    readonly runId: FusionRunId;
    readonly generationId: AgentGenerationId;
    readonly toolCallId: string;
    readonly effectClass: EffectClass;
    readonly fingerprint: string;
    readonly idempotencyKey: string;
    readonly state: EffectState;
    readonly receiptRef?: string;
    readonly outcome?: 'SUCCEEDED' | 'FAILED_KNOWN';
    readonly resolvedBy?: 'receipt' | 'reconcile';
}
export type TransitionMode = 'MANUAL' | 'AUTO_UPGRADE' | 'AUTO_DOWNGRADE' | 'CROSS_PROVIDER';
export type TransitionPhaseState = 'CHECKPOINTED' | 'COMMITTED' | 'ROLLED_BACK';
export interface TransitionTargetSpec {
    agentId: string;
    sessionId: string;
    route: {
        provider: string;
        model: string;
        capabilityDigest: string;
    };
    requirements: {
        requireTools?: string[];
        minContextTokens?: number;
        capabilityDigest?: string;
    };
}
export interface TransitionRecord {
    transitionId: string;
    runId: FusionRunId;
    agentId: string;
    mode: TransitionMode;
    fromGenerationId: AgentGenerationId;
    toGenerationId: AgentGenerationId;
    phase: TransitionPhaseState;
    expectedRevision: number;
    error?: string;
    /** H03: the target spec journaled at checkpoint time so a restart can resume without re-asking. */
    toSpec?: TransitionTargetSpec;
}
export interface GenerationAuthority {
    generationId: AgentGenerationId;
    runId: FusionRunId;
    toolScope: readonly string[];
    writePaths: readonly string[];
    approvalRequired: readonly string[];
}
export type AssignmentRole = 'LEAD' | 'WORKER' | 'REVIEWER';
export type AssignmentStatus = 'OPEN' | 'COMPLETED' | 'FAILED' | 'TAKEN_OVER';
export type ReportStatus = 'COMPLETED' | 'FAILED' | 'NEEDS_INPUT';
export interface AssignmentRecord {
    assignmentId: string;
    runId: FusionRunId;
    role: AssignmentRole;
    workerAgentId?: string;
    briefRevision: number;
    objective: string;
    constraints: readonly string[];
    contextRefs: readonly string[];
    writeScope: readonly string[];
    status: AssignmentStatus;
    lastReportId?: string;
    takenBy?: string;
    takenReason?: string;
    /** H01: DAG dependencies (sorted, acyclic) and currently-held file claims (released on finalize). */
    dependsOn: readonly string[];
    claimedPaths: readonly string[];
    /** I02: latest Lead arbitration ruling (last one wins, journaled per event). */
    arbitration?: {
        ruling: 'REWORK' | 'ACCEPT' | 'ESCALATE';
        by: AgentGenerationId;
        reason: string;
    };
}
export interface AgentReportRecord {
    reportId: string;
    runId: FusionRunId;
    assignmentId: string;
    generationId: AgentGenerationId;
    summary: string;
    status: ReportStatus;
    artifacts: readonly string[];
}
export interface ContextCheckpointRef {
    checkpointId: string;
    runId: FusionRunId;
    generationId: AgentGenerationId;
    epoch: number;
    digest: string;
    totalTokens: number;
    layerTokens: {
        L0: number;
        L1: number;
        L2: number;
        L3: number;
    };
}
export interface WorktreeRecord {
    worktreeId: string;
    runId: FusionRunId;
    generationId: AgentGenerationId;
    path: string;
    branch: string;
    baseCommit: string;
    state: 'ACTIVE' | 'MERGED' | 'ROLLED_BACK' | 'RELEASED';
    mergeCommit?: string;
    mergeDigest?: string;
    rollbackRef?: string;
}
export type EvidenceLevel = 'E0' | 'E1' | 'E2' | 'E3';
export type VerificationVerdict = 'NOT_VERIFIED' | 'VERIFIED' | 'FAILED_VERIFICATION';
export interface EvidenceRecord {
    evidenceId: string;
    runId: FusionRunId;
    requirementId: string;
    level: EvidenceLevel;
    source: string;
    command?: string;
    exitCode?: number;
    artifactDigest?: string;
    producerGenerationId: AgentGenerationId;
}
export interface RequirementRecord {
    requirementId: string;
    runId: FusionRunId;
    evidenceIds: readonly string[];
    verdict: VerificationVerdict;
    verifiedBy?: AgentGenerationId;
}
type EffectIntent = {
    type: 'EFFECT_INTENT_RECORDED';
    runId: FusionRunId;
    effectId: string;
    generationId: AgentGenerationId;
    toolCallId: string;
    effectClass: EffectClass;
    fingerprint: string;
    idempotencyKey: string;
};
type EffectTransition = {
    type: 'EFFECT_DISPATCHED' | 'EFFECT_RECEIPT_RECORDED' | 'EFFECT_UNRESOLVED' | 'EFFECT_RECONCILED' | 'EFFECT_DISCARDED';
    runId: FusionRunId;
    effectId: string;
    receiptRef?: string;
    outcome?: 'SUCCEEDED' | 'FAILED_KNOWN';
};
/** Internal projected domain events, NOT discovered or promised Host SDK events. */
type ContextCheckpointed = {
    type: 'CONTEXT_CHECKPOINTED';
    runId: FusionRunId;
    checkpointId: string;
    generationId: AgentGenerationId;
    epoch: number;
    digest: string;
    totalTokens: number;
    layerTokens: {
        L0: number;
        L1: number;
        L2: number;
        L3: number;
    };
};
export interface BudgetRecord {
    budgetId: string;
    hardCostMicros: number;
    maxCalls?: number;
    maxRetries?: number;
    spentMicros: number;
    reservedMicros: number;
    approvedOverrunMicros: number;
    approvalId?: string;
    openReservations: Readonly<Record<string, number>>;
    usage: Readonly<Record<string, BudgetUsageEntry>>;
}
export interface BudgetUsageEntry {
    runId: FusionRunId;
    providerRequestId: string;
    attempt: number;
    route: ModelRoute;
    priceVersion?: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costMicros: number;
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
}
export interface CacheEntryRecord {
    runId: FusionRunId;
    generationId: AgentGenerationId;
    cacheKey: string;
    savedCostMicros: number;
    keepaliveCostMicros: number;
    expireAt: number;
    policyVersion: string;
    keepaliveActive: boolean;
}
export interface DelegationStats {
    attempts: number;
    failures: number;
    spentMicros: number;
}
type DelegationOutcomeRecorded = {
    type: 'DELEGATION_OUTCOME_RECORDED';
    runId: FusionRunId;
    assignmentId: string;
    mode: 'DIRECT' | 'DELEGATE';
    costMicros: number;
    verdict: 'COMPLETED' | 'FAILED';
};
type CacheEntryRecorded = {
    type: 'CACHE_ENTRY_RECORDED';
    runId: FusionRunId;
    generationId: AgentGenerationId;
    cacheKey: string;
    savedCostMicros: number;
    keepaliveCostMicros: number;
    expireAt: number;
    policyVersion: string;
};
type CacheKeepaliveTick = {
    type: 'CACHE_KEEPALIVE_TICK';
    runId: FusionRunId;
    generationId: AgentGenerationId;
    cacheKey: string;
    tickCostMicros: number;
    savingsRatio: number;
    cachedTokens: number;
};
type CacheKeepaliveStopped = {
    type: 'CACHE_KEEPALIVE_STOPPED';
    runId: FusionRunId;
    generationId: AgentGenerationId;
    cacheKey: string;
    reason: string;
};
type BudgetReserved = {
    type: 'BUDGET_RESERVED';
    runId: FusionRunId;
    budgetId: string;
    hardCostMicros: number;
    maxCalls?: number;
    maxRetries?: number;
};
type BudgetCallReserved = {
    type: 'BUDGET_CALL_RESERVED';
    runId: FusionRunId;
    budgetId: string;
    reservationId: string;
    reserveMicros: number;
};
type BudgetReservationSettled = {
    type: 'BUDGET_RESERVATION_SETTLED';
    runId: FusionRunId;
    budgetId: string;
    reservationId: string;
    providerRequestId: string;
    attempt: number;
    route: ModelRoute;
    priceVersion?: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costMicros: number;
    priced: boolean;
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
};
type BudgetOverrunApproved = {
    type: 'BUDGET_OVERRUN_APPROVED';
    runId: FusionRunId;
    budgetId: string;
    extraMicros: number;
    approvalId: string;
    approver: string;
};
type AssignmentCreated = {
    type: 'ASSIGNMENT_CREATED';
    runId: FusionRunId;
    assignmentId: string;
    role: AssignmentRole;
    workerAgentId?: string;
    brief: {
        objective: string;
        constraints: string[];
        contextRefs: string[];
        revision: number;
    };
    writeScope: string[];
};
type AssignmentBriefRevised = {
    type: 'ASSIGNMENT_BRIEF_REVISED';
    runId: FusionRunId;
    assignmentId: string;
    briefRevision: number;
    objective: string;
    constraints: string[];
    contextRefs: string[];
};
type AssignmentReported = {
    type: 'ASSIGNMENT_REPORTED';
    runId: FusionRunId;
    assignmentId: string;
    reportId: string;
    generationId: AgentGenerationId;
    summary: string;
    status: ReportStatus;
    artifacts: string[];
};
type AssignmentCompleted = {
    type: 'ASSIGNMENT_COMPLETED';
    runId: FusionRunId;
    assignmentId: string;
    reportId: string;
};
type AssignmentFailed = {
    type: 'ASSIGNMENT_FAILED';
    runId: FusionRunId;
    assignmentId: string;
    reportId: string;
};
type AssignmentTakeover = {
    type: 'ASSIGNMENT_TAKEOVER';
    runId: FusionRunId;
    assignmentId: string;
    byAgentId: string;
    reason: string;
};
type AssignmentDependencyDeclared = {
    type: 'ASSIGNMENT_DEPENDENCY_DECLARED';
    runId: FusionRunId;
    assignmentId: string;
    dependsOnId: string;
};
type AssignmentFilesClaimed = {
    type: 'ASSIGNMENT_FILES_CLAIMED';
    runId: FusionRunId;
    assignmentId: string;
    paths: string[];
};
type WorktreeAcquired = {
    type: 'WORKTREE_ACQUIRED';
    runId: FusionRunId;
    worktreeId: string;
    generationId: AgentGenerationId;
    path: string;
    branch: string;
    baseCommit: string;
};
type WorktreeMerged = {
    type: 'WORKTREE_MERGED';
    runId: FusionRunId;
    worktreeId: string;
    mergeCommit: string;
    mergeDigest: string;
};
type WorktreeRolledBack = {
    type: 'WORKTREE_ROLLED_BACK';
    runId: FusionRunId;
    worktreeId: string;
    reason: string;
};
type WorktreeReleased = {
    type: 'WORKTREE_RELEASED';
    runId: FusionRunId;
    worktreeId: string;
};
type WorktreeEvents = WorktreeAcquired | WorktreeMerged | WorktreeRolledBack | WorktreeReleased;
type AssignmentArbitrated = {
    type: 'ASSIGNMENT_ARBITRATED';
    runId: FusionRunId;
    assignmentId: string;
    arbiterGenerationId: AgentGenerationId;
    ruling: 'REWORK' | 'ACCEPT' | 'ESCALATE';
    reason: string;
};
type ReworkOrdered = {
    type: 'REWORK_ORDERED';
    runId: FusionRunId;
    assignmentId: string;
    tier: 'MINOR' | 'MAJOR' | 'BLOCKER';
    addedConstraints: string[];
};
type EvidenceRecorded = {
    type: 'EVIDENCE_RECORDED';
    runId: FusionRunId;
    evidenceId: string;
    requirementId: string;
    level: EvidenceLevel;
    source: string;
    command?: string;
    exitCode?: number;
    artifactDigest?: string;
    producerGenerationId: AgentGenerationId;
};
type VerificationRecorded = {
    type: 'VERIFICATION_RECORDED';
    runId: FusionRunId;
    requirementId: string;
    evidenceId: string;
    verifierGenerationId: AgentGenerationId;
    verdict: Exclude<VerificationVerdict, 'NOT_VERIFIED'> | 'NOT_VERIFIED';
};
type AuthorityIssued = {
    type: 'AUTHORITY_ISSUED';
    runId: FusionRunId;
    generationId: AgentGenerationId;
    toolScope: string[];
    writePaths: string[];
    approvalRequired: string[];
};
type TransitionCheckpointed = {
    type: 'TRANSITION_CHECKPOINTED';
    runId: FusionRunId;
    transitionId: string;
    agentId: string;
    mode: TransitionMode;
    fromGenerationId: AgentGenerationId;
    toGenerationId: AgentGenerationId;
    toSpec?: TransitionTargetSpec;
};
type TransitionCommitted = {
    type: 'TRANSITION_COMMITTED';
    runId: FusionRunId;
    transitionId: string;
};
type TransitionRolledBack = {
    type: 'TRANSITION_ROLLED_BACK';
    runId: FusionRunId;
    transitionId: string;
    error?: string;
};
type TransitionEvents = TransitionCheckpointed | TransitionCommitted | TransitionRolledBack;
export type LifecycleEvent = {
    readonly schemaVersion: 1;
    readonly eventId: string;
    readonly seq: number;
    readonly expectedRevision: number;
} & (Created | Forked | Bound | RunChange | Prepared | GenerationChange | SwitchCommitted | EffectIntent | EffectTransition | TransitionEvents | AuthorityIssued | AssignmentCreated | AssignmentBriefRevised | AssignmentReported | AssignmentCompleted | AssignmentFailed | AssignmentTakeover | AssignmentDependencyDeclared | AssignmentFilesClaimed | WorktreeEvents | EvidenceRecorded | VerificationRecorded | AssignmentArbitrated | ReworkOrdered | ContextCheckpointed | BudgetReserved | BudgetCallReserved | BudgetReservationSettled | BudgetOverrunApproved | CacheEntryRecorded | CacheKeepaliveTick | CacheKeepaliveStopped | DelegationOutcomeRecorded);
export interface LifecycleState {
    readonly revision: number;
    readonly seq: number;
    readonly runs: Readonly<Record<string, FusionRun>>;
    readonly aliases: Readonly<Record<string, SessionAlias>>;
    readonly generations: Readonly<Record<string, AgentGeneration>>;
    readonly lineage: Readonly<Record<string, BranchLineage>>;
    readonly effects: Readonly<Record<string, EffectRecord>>;
    readonly transitions: Readonly<Record<string, TransitionRecord>>;
    readonly authorities: Readonly<Record<string, GenerationAuthority>>;
    readonly assignments: Readonly<Record<string, AssignmentRecord>>;
    readonly reports: Readonly<Record<string, AgentReportRecord>>;
    readonly worktrees: Readonly<Record<string, WorktreeRecord>>;
    readonly evidence: Readonly<Record<string, EvidenceRecord>>;
    readonly requirements: Readonly<Record<string, RequirementRecord>>;
    readonly budgets: Readonly<Record<string, BudgetRecord>>;
    readonly caches: Readonly<Record<string, CacheEntryRecord>>;
    readonly delegation: Readonly<Record<'DIRECT' | 'DELEGATE', DelegationStats>>;
    readonly checkpoints: Readonly<Record<string, ContextCheckpointRef>>;
    /** Event id -> canonical payload; replay duplicate with differing payload is a conflict. */
    readonly appliedEvents: Readonly<Record<string, string>>;
}
export declare const emptyLifecycleState: () => LifecycleState;
export declare function reduceLifecycle(state: LifecycleState, event: LifecycleEvent): LifecycleState;
export declare function replayLifecycle(events: readonly LifecycleEvent[], initial?: LifecycleState): LifecycleState;
export {};
