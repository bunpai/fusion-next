import type { ContextCheckpoint, ContextItem, SummaryRecord } from './index.js';
export interface CompactionThresholds {
    /** Compact once used tokens exceed this ratio of the usable window. */
    compactAboveRatio: number;
    /** Never run a compaction pass for less recoverable mass than this. */
    minDroppableTokens: number;
}
/** Deterministic compaction decision (plan §10: compaction is a Router checkpoint).
 * Pure: the same usage always yields the same decision, so replaying the journal reproduces
 * the same routing. */
export declare function compactionDecision(usage: {
    totalTokens: number;
    contextWindow: number;
}, thresholds: CompactionThresholds): {
    compact: boolean;
    reason: string;
};
/** Canonical prefix fingerprint over the L0/L1 layers only. Compaction must never alter the
 * prefix: the L0 goal/constraints and L1 briefs stay byte-identical so the provider-side KV
 * cache for the stable prefix survives the compaction (plan F02 prefix 稳定). */
export declare function prefixKey(checkpoint: ContextCheckpoint): string;
/** Compaction = transfer into the target window with L3 replaced by verified summaries.
 * The summarizer is injected (the actual summarization is a model call owned by the runtime);
 * this module only enforces the CONTRACT: summaries must verify against their digests before
 * they may enter a checkpoint, and the L0/L1 prefix must remain untouched. */
export declare function compactCheckpoint(checkpoint: ContextCheckpoint, targetWindow: number, summarize: (dropped: readonly ContextItem[]) => readonly SummaryRecord[]): ContextCheckpoint;
export interface KeepaliveProbe {
    cachedTokens: number;
    /** Token-cost multiplier of a cached (read) token vs a fresh one; 0/unknown → no keepalive. */
    cacheSavingsRatio: number;
    keepaliveCostTokens: number;
    idleSeconds: number;
    ttlSeconds: number;
}
/** Cache net-benefit policy (plan F02: 无收益 keepalive 不发生). A keepalive probe is issued
 * ONLY when the cache is still inside its TTL and the projected token saving from retaining
 * the prefix strictly exceeds the probe cost. Unknown economics are never treated as free. */
export declare function keepaliveDecision(probe: KeepaliveProbe): boolean;
