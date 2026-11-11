import type { RunManager } from '../run-manager/index.js';
import type { ModelScoreService } from '../scores/index.js';
import type { RankedPair } from '../optimizer/index.js';
import type { PairOptimizer, RankRequirements, RoutePair } from '../optimizer/index.js';
/** K03 analytics: usage audit (reconciled against the budget report), model combinations via the
 * J02 optimizer, cache net-savings accounting and a deterministic audit export. Failures are
 * always visible — failed assignments, unresolved effects, failed calls and runs in repair are
 * listed, never summarized away. The export digest is canonical-JSON based so it survives restart. */
export type UsageAudit = {
    runId?: string;
    calls: number;
    completed: number;
    failed: number;
    cancelled: number;
    spentMicros: number;
    perRoute: Array<{
        route: string;
        calls: number;
        costMicros: number;
    }>;
};
export type CacheNetSavings = {
    savedCostMicros: number;
    keepaliveCostMicros: number;
    netSavingsMicros: number;
    losingEntries: string[];
};
export type FailureReport = {
    failedAssignments: string[];
    failedReports: string[];
    needsRepairEffects: string[];
    failedCalls: number;
    runsInRepair: string[];
};
export type AuditExport = {
    bundle: {
        runId: string;
        status: string;
        seq: number;
        usage: UsageAudit;
        failures: FailureReport;
        cacheNet: CacheNetSavings;
    };
    digest: string;
};
export declare class AnalyticsService {
    private readonly manager;
    private readonly scores;
    private readonly optimizer?;
    constructor(manager: RunManager, scores: ModelScoreService, optimizer?: PairOptimizer | undefined);
    private usageEntries;
    usageAudit(runId?: string): UsageAudit;
    cacheNetSavings(runId: string): CacheNetSavings;
    failureReport(runId?: string): FailureReport;
    bestModelCombination(pairs: readonly RoutePair[], requirements: RankRequirements): RankedPair | undefined;
    /** Deterministic audit bundle; the digest is over the canonical JSON so it is stable across restarts. */
    auditExport(runId: string): AuditExport;
}
