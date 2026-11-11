import type { ModelRoute } from '../lifecycle/index.js'
import type { PriceTable } from '../budget/index.js'
import type { ModelScoreService } from '../scores/index.js'

/** J02 model-pair optimizer on top of the J01 score statistics.
 *
 * Hard quality gate: a pair is only recommendable when BOTH legs have sufficient samples whose
 * Wilson confidence reaches the required floor — thin histories can never buy their way into a
 * recommendation by being cheap. Cost prediction uses the priced table (an unpriced leg is
 * reported as not estimable, never as free); duration prediction uses ONLY operator-declared
 * speeds and refuses to guess. A/B plans stay pure (no journal events) and are budget-guarded. */

export type RoutePair = { name: string; primary: ModelRoute; fallback: ModelRoute }

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number }

export type RankRequirements = {
  minConfidence: number
  usage?: TokenUsage
  cacheReadTokens?: number
}

export type RankedPair = {
  pair: RoutePair
  predictedCostMicros: number
  confidence: number
  rank: number
}

export type CostEstimate = { priced: true; costMicros: number } | { priced: false }

export type DurationEstimate = { estimable: true; durationMs: number } | { estimable: false; reason: string }

export type AbPlan = {
  arms: Array<{ label: 'A' | 'B'; pair: RoutePair }>
  perArmCostMicros: number
  totalCostMicros: number
}

export type SpeedTable = { speedOf(route: ModelRoute): number | undefined }

const costOf = (prices: PriceTable, route: ModelRoute, usage: TokenUsage): number | undefined => {
  const quote = prices.priceOf(route)
  if (!quote) return undefined
  return usage.inputTokens * quote.inputMicrosPerToken
    + usage.outputTokens * quote.outputMicrosPerToken
    + (usage.cacheReadTokens ?? 0) * (quote.cachedReadMicrosPerToken ?? 0)
}

export class PairOptimizer {
  constructor(private readonly scores: ModelScoreService, private readonly prices: PriceTable,
    private readonly speeds?: SpeedTable) {}

  rankPairs(pairs: readonly RoutePair[], requirements: RankRequirements): RankedPair[] {
    const usage: TokenUsage = requirements.usage ?? { inputTokens: 1000, outputTokens: 500 }
    const usageWithCache = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: requirements.cacheReadTokens ?? usage.cacheReadTokens ?? 0 }
    const ranked: Array<Omit<RankedPair, 'rank'>> = []
    for (const pair of pairs) {
      const primary = this.scores.scoreOf(pair.primary.provider, pair.primary.model)
      const fallback = this.scores.scoreOf(pair.fallback.provider, pair.fallback.model)
      const weaker = Math.min(primary.confidence, fallback.confidence)
      if (!primary.sampleSufficient || !fallback.sampleSufficient) continue
      if (weaker < requirements.minConfidence) continue
      const primaryCost = costOf(this.prices, pair.primary, usageWithCache)
      const fallbackCost = costOf(this.prices, pair.fallback, usageWithCache)
      if (primaryCost === undefined || fallbackCost === undefined) continue
      ranked.push({ pair, predictedCostMicros: primaryCost + fallbackCost, confidence: weaker })
    }
    ranked.sort((a, b) => a.predictedCostMicros - b.predictedCostMicros
      || b.confidence - a.confidence
      || a.pair.name.localeCompare(b.pair.name))
    return ranked.map((entry, index) => ({ ...entry, rank: index + 1 }))
  }

  estimatePairCost(pair: RoutePair, usage: TokenUsage): CostEstimate {
    const primaryCost = costOf(this.prices, pair.primary, usage)
    const fallbackCost = costOf(this.prices, pair.fallback, usage)
    if (primaryCost === undefined || fallbackCost === undefined) return { priced: false }
    return { priced: true, costMicros: primaryCost + fallbackCost }
  }

  planAbTest(pairA: RoutePair, pairB: RoutePair, budget: { remainingMicros: number; perArmCostMicros: number }): AbPlan {
    const total = budget.perArmCostMicros * 2
    if (total > budget.remainingMicros) {
      throw new Error(`AB_TEST_BUDGET_EXCEEDED: arms need ${total}µ but only ${budget.remainingMicros}µ remain`)
    }
    return { arms: [{ label: 'A', pair: pairA }, { label: 'B', pair: pairB }], perArmCostMicros: budget.perArmCostMicros, totalCostMicros: total }
  }

  predictDuration(route: ModelRoute, outputTokens: number): DurationEstimate {
    const speed = this.speeds?.speedOf(route)
    if (speed === undefined || !Number.isFinite(speed) || speed <= 0) {
      return { estimable: false, reason: `no operator-declared speed for ${route.provider}/${route.model}; refusing to guess latency` }
    }
    return { estimable: true, durationMs: Math.ceil(outputTokens / speed) }
  }
}
