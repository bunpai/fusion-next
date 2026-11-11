import { AgentGenerationId, FusionRunId, type EffectClass, type EffectRecord } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
/** sha256 over canonical JSON of {tool,args,target}; the documented fingerprint rule (plan §8). */
export declare function effectFingerprint(tool: string, args: unknown, target: string): string;
export type EffectOutcome = 'SUCCEEDED' | 'FAILED_KNOWN';
export interface EffectIntentInput {
    readonly effectId: string;
    readonly generationId: AgentGenerationId;
    readonly toolCallId: string;
    readonly effectClass: EffectClass;
    readonly fingerprint: string;
    readonly idempotencyKey: string;
}
export interface EffectAppendOptions {
    readonly beforeCommit?: () => void;
}
export interface DrainResult {
    readonly settled: number;
    readonly discarded: number;
}
export declare class EffectLedger {
    private readonly manager;
    constructor(manager: RunManager);
    list(runId: FusionRunId): EffectRecord[];
    find(runId: FusionRunId, idempotencyKey: string): EffectRecord | undefined;
    recordIntent(runId: FusionRunId, input: EffectIntentInput, expectedRevision: number, options?: EffectAppendOptions): EffectRecord;
    dispatch(runId: FusionRunId, effectId: string, expectedRevision: number, options?: EffectAppendOptions): EffectRecord;
    recordReceipt(runId: FusionRunId, effectId: string, receiptRef: string, outcome: EffectOutcome, expectedRevision: number, options?: EffectAppendOptions): EffectRecord;
    /** Unknown external outcome: no retry decision can be made automatically. */
    markUnresolved(runId: FusionRunId, effectId: string, expectedRevision: number, options?: EffectAppendOptions): EffectRecord;
    /** Verified resolution of a NEEDS_REPAIR effect; outcome must come from an external check. */
    reconcile(runId: FusionRunId, effectId: string, receiptRef: string, outcome: EffectOutcome, expectedRevision: number, options?: EffectAppendOptions): EffectRecord;
    /** Only an intent that was never dispatched may be dropped without external verification. */
    discard(runId: FusionRunId, effectId: string, expectedRevision: number, options?: EffectAppendOptions): EffectRecord;
    /** Drain barrier: a run may only leave its tool boundary with every effect terminal.
     * Throws EFFECT_DRAIN_BLOCKED while INTENT/EXECUTING/NEEDS_REPAIR effects remain. */
    drain(runId: FusionRunId): DrainResult;
    private get;
    private commit;
}
