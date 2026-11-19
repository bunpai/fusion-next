import type { TaskId } from '../contracts.js';
import type { SqliteFusionStore } from '../task/sqlite-store.js';
/**
 * V3 runtime projection — the only mutable task document the coordinator
 * maintains. Replaces the legacy 'runtime:<taskId>' work-order machine and the
 * reducer-driven TaskState: a pair selection creates the doc once, every
 * fusion_dispatch appends/closes a DispatchRecord, and status/history/UI read
 * this shape directly. Kept deliberately small — the full worker transcript
 * stays in the native child session, this is the audit summary.
 */
export interface DispatchCheck {
    readonly command: string;
    readonly exitCode: number;
    readonly summary: string;
}
export interface DispatchRecord {
    readonly id: string;
    readonly instruction: string;
    readonly startedAt: string;
    endedAt?: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted' | 'steered' | 'rejected' | 'stalled' | 'quarantined' | 'infra';
    changedFiles?: readonly string[];
    checks?: readonly DispatchCheck[];
    warnings?: readonly string[];
    repairRounds?: number;
    error?: string;
    /** M0 instrumentation: worker assistant messages during this dispatch. */
    workerSteps?: number;
    /** Serialized AuditBundle size the Lead ingested. */
    bundleBytes?: number;
    /** Wall time from dispatch begin to finish. */
    wallMs?: number;
    /** First failing verify command as `command@exitCode` — escalation-dedup key. */
    failureSignature?: string;
    /** M2.1: normalized-instruction sha256 — the identical-resend hard gate key. */
    instructionHash?: string;
    /** M2.1 advisory: instruction 2-gram Jaccard >= 0.8 vs the last failed one. */
    resendSuspect?: boolean;
    /** M2.3: watchdog break — which limit tripped and what was consumed. */
    stall?: {
        reason: 'steps' | 'wall';
        budgetUsed: {
            steps: number;
            wallMs: number;
        };
    };
    /** M2.3: last observed child tool call at interruption (name + arg head). */
    lastActivity?: string;
    /** User-turn epoch (count of user messages in the session) when this
     *  dispatch began — scopes the rework budget to the current user request. */
    epoch?: number;
}
export interface RuntimeV3 {
    readonly schemaVersion: 3;
    readonly taskId: TaskId;
    readonly createdAt: string;
    updatedAt: string;
    /** Durable worker reservation: the child survives dispatch aborts. */
    worker?: {
        childId: string;
    };
    dispatches: DispatchRecord[];
    /** Present while the user paused the pair; canRequest denies with this reason. */
    paused?: string;
    /** Terminal marker once the binding was cleared. */
    cleared?: string;
    /** M2.1: provider-level failures (429/5xx/timeout) — separate from the rework budget. */
    infraAttempts?: number;
    /** User-turn epoch the current counters belong to. A new user message opens
     *  a new epoch: the rework budget and infra counter reset so a bad stretch
     *  cannot brick the session for every later request. */
    turnEpoch?: number;
}
/** Normalize an instruction for dedup: NFKC -> whitespace collapse -> lowercase ->
 * strip sentence punctuation (CJK/ASCII); keep - _ / . : so a-b.ts != ab.ts. */
export declare function normalizeInstruction(text: string): string;
export declare function instructionHash(text: string): string;
/** 2-gram Jaccard over the normalized text — cosmetic-resend advisory signal. */
export declare function instructionSimilarity(a: string, b: string): number;
/** Trailing consecutive execution failures inside one user-turn epoch — the
 *  rework-budget consumers. 'rejected' records are transparent (they never
 *  ran); 'stalled'/'quarantined' are watchdog outcomes handled by the repair
 *  path, not worker execution failures; any other status ends the streak.
 *  Records from an older epoch end the streak too. */
export declare function executionFailures(runtime: RuntimeV3 | undefined, epoch?: number): number;
/** The most recent execution-failure record — dedup/similarity comparator. */
export declare function lastFailedDispatch(runtime: RuntimeV3 | undefined): DispatchRecord | undefined;
export declare function readRuntime(store: SqliteFusionStore, taskId: TaskId): RuntimeV3 | undefined;
export declare function createRuntime(store: SqliteFusionStore, taskId: TaskId): RuntimeV3;
/** Read-modify-write with CAS retry; the only writer is this coordinator. */
export declare function updateRuntime(store: SqliteFusionStore, taskId: TaskId, mutate: (runtime: RuntimeV3) => void): RuntimeV3;
/** A dispatch the Lead tool call is still settled on (or lost to steering). */
export declare function liveDispatch(runtime: RuntimeV3 | undefined): DispatchRecord | undefined;
export declare function beginDispatch(store: SqliteFusionStore, taskId: TaskId, instruction: string, extra?: Partial<DispatchRecord>): DispatchRecord;
export declare function finishDispatch(store: SqliteFusionStore, taskId: TaskId, id: string, patch: Partial<DispatchRecord>): void;
