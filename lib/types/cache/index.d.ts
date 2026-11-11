import type { RunManager } from '../run-manager/index.js';
export type CacheEntryInput = {
    savedCostMicros: number;
    keepaliveCostMicros: number;
    expireAt: number;
    policyVersion: string;
};
export type KeepaliveTickInput = {
    tickCostMicros: number;
    idleSeconds: number;
    ttlSeconds: number;
    savingsRatio: number;
    cachedTokens: number;
};
export type CacheEntryView = {
    runId: string;
    generationId: string;
    cacheKey: string;
    savedCostMicros: number;
    keepaliveCostMicros: number;
    expireAt: number;
    policyVersion: string;
    active: boolean;
};
/** G03 cache ledger.
 *
 * F02's `keepaliveDecision` proposes whether a keepalive tick should be scheduled; this ledger
 * disposes with hard accounting (plan Q10): a tick is journaled only while the entry is unexpired
 * AND cumulative keepalive spend stays below the recorded savings. The moment a tick would push the
 * cumulative keepalive cost past the savings — or the entry expired — the ledger stops keepalive
 * automatically instead of paying for a losing entry. */
export declare class CachePolicyService {
    private readonly manager;
    constructor(manager: RunManager);
    record(runId: string, generationId: string, cacheKey: string, input: CacheEntryInput): void;
    keepaliveTick(runId: string, generationId: string, cacheKey: string, tick: KeepaliveTickInput): void;
    entry(runId: string, generationId: string, cacheKey: string): CacheEntryView | undefined;
    private stop;
    private append;
}
