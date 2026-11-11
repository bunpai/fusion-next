import type { RunManager } from '../run-manager/index.js';
/** J01 model score statistics over the journaled budget usage ledger (G02) and verifier verdicts.
 *
 * Scores are a pure projection of the journal — no new events. Failures and cancellations count
 * in the denominator. Small samples are never ranked: ranking uses the Wilson lower confidence
 * bound and requires a minimum sample count so tiny histories cannot overfit routing decisions. */
export type ScoreStats = {
    provider: string;
    model: string;
    attempts: number;
    successes: number;
    failures: number;
    cancelled: number;
    spentMicros: number;
    successRate: number;
    /** Wilson lower bound at 95% confidence — the honest pessimistic success estimate. */
    confidence: number;
    /** False until attempts reaches minSamples; insufficient samples are excluded from ranking. */
    sampleSufficient: boolean;
};
export type RankedRoute = ScoreStats & {
    rank: number;
};
export declare function wilsonLowerBound(successes: number, attempts: number): number;
export declare class ModelScoreService {
    private readonly manager;
    private readonly minSamples;
    constructor(manager: RunManager, minSamples?: number);
    private collect;
    scoreOf(provider: string, model: string): ScoreStats;
    /** Only sample-sufficient routes are ranked, by Wilson lower bound then raw success rate. */
    rank(): RankedRoute[];
}
