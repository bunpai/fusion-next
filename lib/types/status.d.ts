import type { PhysicalRoute, Role, TokenMeasurement, VerificationLevel } from './contracts.js';
/** Legacy model-control shape kept for client compatibility; v3 never sets it. */
export interface ControlView {
    schemaVersion: 1;
    sessionId: string;
    profileDigest: string;
    epoch: number;
    recoveryEpoch?: number;
    leadRecoveries?: {
        taskId: string;
        count: number;
    };
    routes: Record<Role, PhysicalRoute>;
    waits: Partial<Record<Role, {
        taskId: string;
        code: string;
        at: string;
        retryNotBefore?: string;
        quotaResetAt: null;
    }>>;
    operation?: {
        id: string;
        taskId: string;
        state: 'prepared' | 'dispatching' | 'delivered' | 'failed';
        message?: unknown;
        error?: string;
    };
    schedule?: {
        id: string;
        taskId: string;
        epoch: number;
        dueAt: string;
        userSeq: number;
        state: 'scheduled' | 'cancelled' | 'fired' | 'failed';
        reason?: string;
    };
    revision: number;
}
/** Bounded, read-only UI projection. No prompts, tool arguments or credentials. */
export interface FusionStatus {
    schemaVersion: 1;
    sessionId: string;
    selected: boolean;
    observedAt: string;
    task?: {
        id: string;
        revision: number;
        stage: string;
        detail: string | null;
        /** English copies for an English DSH; optional so older records still read. */
        stageEn?: string;
        detailEn?: string | null;
        attention: boolean;
        verification: VerificationLevel;
        workerId: string | null;
        modelControl?: ControlView;
        models: {
            lead: PhysicalRoute;
            worker: PhysicalRoute;
            compactor: PhysicalRoute | null;
        };
        usage: {
            calls: number;
            finalCalls: number;
            provisionalCalls: number;
            unreportedCalls: number;
            compactionCalls: number;
            keepaliveCalls: number;
            /** Known subtotals only; missing request fields never become zero totals. */
            input: UsageSubtotal;
            cacheRead: UsageSubtotal;
            output: UsageSubtotal;
            actualBilledUsd: null;
            upstreamHttpCalls: null;
            /** Where the tokens went: the point of Fusion is that most land on the cheaper Worker. */
            byRole: Record<Role, RoleUsage>;
        };
        /** Checks frozen on the current work order; 0 means the Lead review was the only verification. */
        automatedChecks: number | null;
        requests: {
            id: string;
            role: Role;
            purpose: string;
            provider: string;
            model: string;
            outcome: string;
            authority: 'none' | 'provisional' | 'final';
            startedAt: string;
        }[];
        tools: {
            id: string;
            role: Role;
            name: string;
            state: string;
            failed: boolean;
            startedAt: string;
        }[];
        contexts: {
            role: Role;
            purpose: string;
            inputTokens: number;
            budget: number;
            quality: TokenMeasurement['quality'];
            admitted: boolean;
            checkedAt: string;
        }[];
        pendingApprovals: number;
        unsettledTools: number;
        /** True while a human inspection is required before continue, model switch, or leaving Fusion. */
        recovering?: boolean;
        outcomeUnknown?: boolean;
    };
}
export interface RoleUsage {
    calls: number;
    input: UsageSubtotal;
    cacheRead: UsageSubtotal;
    output: UsageSubtotal;
}
export interface UsageSubtotal {
    knownTokens: number;
    reportedRequests: number;
    totalRequests: number;
}
