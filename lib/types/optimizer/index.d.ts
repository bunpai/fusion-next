import type { ModelRoute } from '../lifecycle/index.js';
import type { PriceTable } from '../budget/index.js';
import type { ModelScoreService } from '../scores/index.js';
/** J02 model-pair optimizer on top of the J01 score statistics.
 *
 * Hard quality gate: a pair is only recommendable when BOTH legs have sufficient samples whose
 * Wilson confidence reaches the required floor — thin histories can never buy their way into a
 * recommendation by being cheap. Cost prediction uses the priced table (an unpriced leg is
 * reported as not estimable, never as free); duration prediction uses ONLY operator-declared
 * speeds and refuses to guess. A/B plans stay pure (no journal events) and are budget-guarded. */
export type RoutePair = {
    name: string;
    primary: ModelRoute;
    fallback: ModelRoute;
};
export type TokenUsage = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
};
export type RankRequirements = {
    minConfidence: number;
    usage?: TokenUsage;
    cacheReadTokens?: number;
};
export type RankedPair = {
    pair: RoutePair;
    predictedCostMicros: number;
    confidence: number;
    rank: number;
};
export type CostEstimate = {
    priced: true;
    costMicros: number;
} | {
    priced: false;
};
export type DurationEstimate = {
    estimable: true;
    durationMs: number;
} | {
    estimable: false;
    reason: string;
};
export type AbPlan = {
    arms: Array<{
        label: 'A' | 'B';
        pair: RoutePair;
    }>;
    perArmCostMicros: number;
    totalCostMicros: number;
};
export type SpeedTable = {
    speedOf(route: ModelRoute): number | undefined;
};
export declare class PairOptimizer {
    private readonly scores;
    private readonly prices;
    private readonly speeds?;
    constructor(scores: ModelScoreService, prices: PriceTable, speeds?: SpeedTable | undefined);
    rankPairs(pairs: readonly RoutePair[], requirements: RankRequirements): RankedPair[];
    estimatePairCost(pair: RoutePair, usage: TokenUsage): CostEstimate;
    planAbTest(pairA: RoutePair, pairB: RoutePair, budget: {
        remainingMicros: number;
        perArmCostMicros: number;
    }): AbPlan;
    predictDuration(route: ModelRoute, outputTokens: number): DurationEstimate;
}
