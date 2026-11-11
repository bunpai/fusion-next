import { createHash } from 'node:crypto'
import type { ContextCheckpoint, ContextItem, SummaryRecord } from './index.js'
import { repackForTransfer, verifySummary } from './index.js'

export interface CompactionThresholds {
  /** Compact once used tokens exceed this ratio of the usable window. */
  compactAboveRatio: number
  /** Never run a compaction pass for less recoverable mass than this. */
  minDroppableTokens: number
}

/** Deterministic compaction decision (plan §10: compaction is a Router checkpoint).
 * Pure: the same usage always yields the same decision, so replaying the journal reproduces
 * the same routing. */
export function compactionDecision(usage: { totalTokens: number; contextWindow: number },
  thresholds: CompactionThresholds): { compact: boolean; reason: string } {
  if (!Number.isSafeInteger(usage.contextWindow) || usage.contextWindow <= 0) {
    throw new Error('CONTEXT_BUDGET_INVALID: context window must be a positive integer')
  }
  const usable = usage.contextWindow - Math.floor(usage.contextWindow * 0.2)
  const ratio = usage.totalTokens / usable
  if (ratio <= thresholds.compactAboveRatio) {
    return { compact: false, reason: `usage ${usage.totalTokens} <= ${thresholds.compactAboveRatio} of usable ${usable}` }
  }
  if (usage.totalTokens < thresholds.minDroppableTokens) {
    return { compact: false, reason: `recoverable mass below ${thresholds.minDroppableTokens}` }
  }
  return { compact: true, reason: `usage ${usage.totalTokens} > ${thresholds.compactAboveRatio} of usable ${usable}` }
}

/** Canonical prefix fingerprint over the L0/L1 layers only. Compaction must never alter the
 * prefix: the L0 goal/constraints and L1 briefs stay byte-identical so the provider-side KV
 * cache for the stable prefix survives the compaction (plan F02 prefix 稳定). */
export function prefixKey(checkpoint: ContextCheckpoint): string {
  const prefix = checkpoint.items
    .filter(entry => entry.layer === 'L0' || entry.layer === 'L1')
    .map(entry => [entry.layer, entry.id, entry.digest])
  return createHash('sha256').update(JSON.stringify(prefix)).digest('hex')
}

/** Compaction = transfer into the target window with L3 replaced by verified summaries.
 * The summarizer is injected (the actual summarization is a model call owned by the runtime);
 * this module only enforces the CONTRACT: summaries must verify against their digests before
 * they may enter a checkpoint, and the L0/L1 prefix must remain untouched. */
export function compactCheckpoint(checkpoint: ContextCheckpoint, targetWindow: number,
  summarize: (dropped: readonly ContextItem[]) => readonly SummaryRecord[]): ContextCheckpoint {
  const before = prefixKey(checkpoint)
  const droppedRaw = checkpoint.items.filter(entry => entry.layer === 'L3')
  const summaries = summarize(droppedRaw)
  for (const summary of summaries) verifySummary(summary)
  const summaryItems: ContextItem[] = summaries.map(summary => ({
    layer: 'L2', id: summary.id, tokens: Math.ceil(summary.content.length / 4),
    digest: summary.digest, content: summary.content,
  }))
  const kept = checkpoint.items.filter(entry => entry.layer !== 'L3')
  const repacked = repackForTransfer({ ...checkpoint, items: [...kept, ...summaryItems] }, targetWindow)
  if (prefixKey(repacked) !== before) {
    throw new Error('COMPACTION_PREFIX_BROKEN: compaction altered the stable L0/L1 prefix')
  }
  return repacked
}

export interface KeepaliveProbe {
  cachedTokens: number
  /** Token-cost multiplier of a cached (read) token vs a fresh one; 0/unknown → no keepalive. */
  cacheSavingsRatio: number
  keepaliveCostTokens: number
  idleSeconds: number
  ttlSeconds: number
}

/** Cache net-benefit policy (plan F02: 无收益 keepalive 不发生). A keepalive probe is issued
 * ONLY when the cache is still inside its TTL and the projected token saving from retaining
 * the prefix strictly exceeds the probe cost. Unknown economics are never treated as free. */
export function keepaliveDecision(probe: KeepaliveProbe): boolean {
  if (probe.idleSeconds >= probe.ttlSeconds) return false
  if (!Number.isFinite(probe.cacheSavingsRatio) || probe.cacheSavingsRatio <= 0) return false
  const projectedSavings = probe.cachedTokens * (probe.cacheSavingsRatio - 1)
  return projectedSavings > probe.keepaliveCostTokens
}
