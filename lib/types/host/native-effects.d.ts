import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type { JobView } from '@deepseek-ai/dsh-jobs';
import type { ArtifactRef, Role, TaskId } from '../contracts.js';
import type { SqliteFusionStore } from '../task/sqlite-store.js';
import type { SessionBinding } from './bindings.js';
interface EffectRecord {
    schemaVersion: 1;
    taskId: TaskId;
    agentId: string;
    role: Role;
    callId: string;
    rootCallId: string;
    toolName: string;
    processId: number;
    startedAt: string;
    state: 'dispatch-started' | 'returned' | 'outcome-unknown' | 'inspected';
    arguments: ArtifactRef;
    endedAt?: string;
    nativeIsError?: boolean;
    inspectionEvidence?: string;
    quiescenceBasis?: 'explicit-user-inspection';
    nativeJob?: {
        id: string;
        startedAt: number;
        deadlineAt: number | null;
        status: JobView['status'];
        detail?: string;
    };
}
/** Public native dispatch journal; it never wraps a provider or invents a PID. */
export declare class NativeEffects {
    #private;
    readonly ctx: Context;
    readonly store: SqliteFusionStore;
    readonly callbacks: {
        owner(agent: Agent): {
            binding: SessionBinding;
            role: Role;
        } | undefined;
        track(exec: Readonly<ToolExecution>): boolean;
        failed(agent: Agent, error: unknown): void;
        backgroundMaxMs?(exec: Readonly<ToolExecution>, binding: SessionBinding): number | null;
    };
    constructor(ctx: Context, store: SqliteFusionStore, callbacks: {
        owner(agent: Agent): {
            binding: SessionBinding;
            role: Role;
        } | undefined;
        track(exec: Readonly<ToolExecution>): boolean;
        failed(agent: Agent, error: unknown): void;
        backgroundMaxMs?(exec: Readonly<ToolExecution>, binding: SessionBinding): number | null;
    });
    install(): () => void;
    backgroundProblem(exec: Readonly<ToolExecution>): string | undefined;
    jobProblem(exec: Readonly<ToolExecution>, taskId: TaskId): string | undefined;
    waitingForJob(agent: Agent): boolean;
    onlyBackgroundPending(taskId: TaskId, exec?: {
        callId: string;
        rootCallId: string;
    }): boolean;
    stopJobs(taskId: TaskId): Promise<void>;
    /**
     * Pending effects excluding the tool call that contains the current dispatch.
     * Under PTC every tool runs inside a run_code dispatch, which is itself a tracked
     * mutation whose effect stays 'dispatch-started' for the entire inner call — a
     * work-order gate that treats it as unsettled deadlocks. Only ancestor calls are
     * excluded: the containing call's id prefixes inner ':ptc:N' ids (and equals their
     * rootCallId). Sibling inner calls (X:ptc:0 pending while X:ptc:1 runs) still count.
     * `agentId` further restricts the count to one Agent's own effects: submit/finish
     * gates ask "does THIS Agent still owe settlement", not "is anyone in the task busy".
     */
    pendingFor(taskId: TaskId, exec?: {
        callId: string;
        rootCallId: string;
    }, agentId?: string): readonly {
        id: string;
        record: EffectRecord;
    }[];
    pending(taskId: TaskId): readonly {
        id: string;
        record: EffectRecord;
    }[];
    assertInspection(taskId: TaskId, effectsStopped: boolean): void;
    inspected(taskId: TaskId, evidence: string, effectsStopped: boolean): void;
}
export {};
