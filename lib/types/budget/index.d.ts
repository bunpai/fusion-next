import { type ModelRoute } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
export interface PriceQuote {
    inputMicrosPerToken: number;
    outputMicrosPerToken: number;
    cachedReadMicrosPerToken?: number;
    priceVersion: string;
}
export type PriceTable = {
    priceOf(route: ModelRoute): PriceQuote | undefined;
};
export type UsageGuess = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
};
export type CostEstimate = {
    priced: true;
    costMicros: number;
    priceVersion: string;
} | {
    priced: false;
};
export type SettlementInput = {
    reservationId: string;
    providerRequestId: string;
    attempt: number;
    route: ModelRoute;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
};
export type BudgetReport = {
    hardCostMicros: number;
    spentMicros: number;
    reservedMicros: number;
    approvedOverrunMicros: number;
    remainingMicros: number;
    openReservations: Readonly<Record<string, number>>;
};
/** G02 cost/budget ledger.
 *
 * Prices are resolved through a PriceTable; a route without a price is UNPRICED and can never be
 * settled for free — an unpriced settlement is rejected before any event (plan §15: 未知价格不当作免费,
 * 未授权超支=0). Caps are enforced inside the reducer, so even a buggy caller cannot push a run past
 * `hardCost + approvedOverrun`; overrun exists only through an explicit auditable approval event. */
export declare class BudgetService {
    private readonly manager;
    private readonly prices;
    constructor(manager: RunManager, prices: PriceTable);
    estimate(route: ModelRoute, usage: UsageGuess): CostEstimate;
    reserve(runId: string, budgetId: string, hardCostMicros: number, opts?: {
        maxCalls?: number;
        maxRetries?: number;
    }): void;
    reserveCall(runId: string, budgetId: string, reservationId: string, reserveMicros: number): void;
    settle(runId: string, budgetId: string, input: SettlementInput): void;
    approveOverrun(runId: string, budgetId: string, extraMicros: number, approvalId: string, approver: string): void;
    get(budgetId: string): import("../lifecycle/index.js").BudgetRecord;
    report(budgetId: string): BudgetReport;
    private append;
}
