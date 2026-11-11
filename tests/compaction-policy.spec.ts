import { describe, expect, it } from 'vitest'
import { FusionRunId } from '../src/lifecycle/index.js'
import { makeCheckpoint, makeSummary, type ContextItem, type SummaryRecord } from '../src/context/index.js'
import { compactionDecision, compactCheckpoint, keepaliveDecision, prefixKey, type CompactionThresholds } from '../src/context/compaction.js'

const run = FusionRunId('run-1')

const item = (layer: ContextItem['layer'], id: string, tokens: number): ContextItem =>
  ({ layer, id, tokens, digest: `d-${layer}-${id}`, content: `content ${layer} ${id}` })

describe('F02 compaction checkpoint routing and cache net-benefit policy', () => {
  const thresholds: CompactionThresholds = { compactAboveRatio: 0.7, minDroppableTokens: 1000 }

  it('decides compaction deterministically from the usable-window ratio', () => {
    // 32k window: reserved 6.4k, usable 25.6k → compact above 17,920 tokens.
    expect(compactionDecision({ totalTokens: 10_000, contextWindow: 32_000 }, thresholds).compact).toBe(false)
    expect(compactionDecision({ totalTokens: 18_000, contextWindow: 32_000 }, thresholds).compact).toBe(true)
    // Below the minimum droppable mass there is nothing worth compacting.
    expect(compactionDecision({ totalTokens: 18_000, contextWindow: 32_000 },
      { compactAboveRatio: 0.7, minDroppableTokens: 50_000 }).compact).toBe(false)
  })

  it('compacts by dropping L3 into verified summaries and keeps the L0/L1 prefix byte-stable', () => {
    const big = makeCheckpoint(run, 'g-1', 1, [
      item('L0', 'goal', 500), item('L1', 'brief', 1500),
      item('L2', 'e-1', 4000), item('L3', 'h-1', 8000), item('L3', 'h-2', 8000),
    ])
    const summarize = (dropped: readonly ContextItem[]): SummaryRecord[] =>
      dropped.map(entry => makeSummary(`sum-${entry.id}`, `summary of ${entry.id}`))
    const compacted = compactCheckpoint(big, 32_000, summarize)
    // Prefix stability: L0/L1 items are identical before and after compaction.
    expect(prefixKey(compacted)).toBe(prefixKey(big))
    expect(compacted.items.every(entry => entry.layer !== 'L3')).toBe(true)
    expect(compacted.totalTokens).toBeLessThan(big.totalTokens)
    expect(compacted.layerTokens.L2).toBeGreaterThan(big.layerTokens.L2)
  })

  it('fails closed when an L2 summary fails digest verification', () => {
    const big = makeCheckpoint(run, 'g-1', 1, [item('L0', 'goal', 500), item('L2', 'e-1', 4000)])
    const tampered = { ...makeSummary('sum-e-1', 'truthful summary'), digest: 'forged' }
    expect(() => compactCheckpoint(big, 32_000, () => [tampered])).toThrow(/SUMMARY_DIGEST_MISMATCH/)
  })

  it('keeps the cache alive only when the projected saving exceeds the keepalive cost', () => {
    // 50k cached tokens at 4x read cost vs 1x write: keeping the prefix saves real tokens.
    expect(keepaliveDecision({ cachedTokens: 50_000, cacheSavingsRatio: 4, keepaliveCostTokens: 1_200, idleSeconds: 60, ttlSeconds: 300 })).toBe(true)
    // No net benefit: the keepalive would cost more than it saves — never issued.
    expect(keepaliveDecision({ cachedTokens: 200, cacheSavingsRatio: 4, keepaliveCostTokens: 1_200, idleSeconds: 60, ttlSeconds: 300 })).toBe(false)
    expect(keepaliveDecision({ cachedTokens: 50_000, cacheSavingsRatio: 1, keepaliveCostTokens: 1_200, idleSeconds: 60, ttlSeconds: 300 })).toBe(false)
    // Unknown economics are not treated as free: no savings ratio → no keepalive.
    expect(keepaliveDecision({ cachedTokens: 50_000, cacheSavingsRatio: 0, keepaliveCostTokens: 1_200, idleSeconds: 60, ttlSeconds: 300 })).toBe(false)
    // Already past the TTL there is nothing left to preserve.
    expect(keepaliveDecision({ cachedTokens: 50_000, cacheSavingsRatio: 4, keepaliveCostTokens: 1_200, idleSeconds: 400, ttlSeconds: 300 })).toBe(false)
  })
})
