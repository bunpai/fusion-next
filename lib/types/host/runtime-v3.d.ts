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
    status: 'running' | 'completed' | 'failed' | 'interrupted' | 'steered';
    changedFiles?: readonly string[];
    checks?: readonly DispatchCheck[];
    warnings?: readonly string[];
    repairRounds?: number;
    error?: string;
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
}
export declare function readRuntime(store: SqliteFusionStore, taskId: TaskId): RuntimeV3 | undefined;
export declare function createRuntime(store: SqliteFusionStore, taskId: TaskId): RuntimeV3;
/** Read-modify-write with CAS retry; the only writer is this coordinator. */
export declare function updateRuntime(store: SqliteFusionStore, taskId: TaskId, mutate: (runtime: RuntimeV3) => void): RuntimeV3;
/** A dispatch the Lead tool call is still settled on (or lost to steering). */
export declare function liveDispatch(runtime: RuntimeV3 | undefined): DispatchRecord | undefined;
export declare function beginDispatch(store: SqliteFusionStore, taskId: TaskId, instruction: string): DispatchRecord;
export declare function finishDispatch(store: SqliteFusionStore, taskId: TaskId, id: string, patch: Partial<DispatchRecord>): void;
