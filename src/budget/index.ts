import { FusionRunId, type FusionRunId as FusionRunIdBrand, type ModelRoute } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'

export interface PriceQuote {
  inputMicrosPerToken: number
  outputMicrosPerToken: number
  cachedReadMicrosPerToken?: number
  priceVersion: string
}
export type PriceTable = { priceOf(route: ModelRoute): PriceQuote | undefined }
export type UsageGuess = { inputTokens: number; outputTokens: number; cacheReadTokens: number }
export type CostEstimate =
  | { priced: true; costMicros: number; priceVersion: string }
  | { priced: false }
export type SettlementInput = {
  reservationId: string; providerRequestId: string; attempt: number; route: ModelRoute
  inputTokens: number; outputTokens: number; cacheReadTokens: number
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED'
}
export type BudgetReport = {
  hardCostMicros: number; spentMicros: number; reservedMicros: number
  approvedOverrunMicros: number; remainingMicros: number
  openReservations: Readonly<Record<string, number>>
}

/** G02 cost/budget ledger.
 *
 * Prices are resolved through a PriceTable; a route without a price is UNPRICED and can never be
 * settled for free — an unpriced settlement is rejected before any event (plan §15: 未知价格不当作免费,
 * 未授权超支=0). Caps are enforced inside the reducer, so even a buggy caller cannot push a run past
 * `hardCost + approvedOverrun`; overrun exists only through an explicit auditable approval event. */
export class BudgetService {
  constructor(private readonly manager: RunManager, private readonly prices: PriceTable) {}

  estimate(route: ModelRoute, usage: UsageGuess): CostEstimate {
    const quote = this.prices.priceOf(route)
    if (!quote) return { priced: false }
    const cost = usage.inputTokens * quote.inputMicrosPerToken
      + usage.outputTokens * quote.outputMicrosPerToken
      + usage.cacheReadTokens * (quote.cachedReadMicrosPerToken ?? 0)
    return { priced: true, costMicros: cost, priceVersion: quote.priceVersion }
  }

  reserve(runId: string, budgetId: string, hardCostMicros: number,
    opts: { maxCalls?: number; maxRetries?: number } = {}): void {
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/budget/${budgetId}/reserved`,
      type: 'BUDGET_RESERVED', runId: FusionRunId(runId), budgetId, hardCostMicros,
      maxCalls: opts.maxCalls, maxRetries: opts.maxRetries } as RunEventInput)
  }

  reserveCall(runId: string, budgetId: string, reservationId: string, reserveMicros: number): void {
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/budget/${budgetId}/reserve/${reservationId}`,
      type: 'BUDGET_CALL_RESERVED', runId: FusionRunId(runId), budgetId, reservationId, reserveMicros } as RunEventInput)
  }

  settle(runId: string, budgetId: string, input: SettlementInput): void {
    const estimate = this.estimate(input.route, input)
    if (!estimate.priced) {
      throw new Error(`BUDGET_UNPRICED: route ${input.route.provider}/${input.route.model} has no price; refusing to treat unknown cost as free`)
    }
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/budget/${budgetId}/settle/${input.reservationId}`,
      type: 'BUDGET_RESERVATION_SETTLED', runId: FusionRunId(runId), budgetId, reservationId: input.reservationId,
      providerRequestId: input.providerRequestId, attempt: input.attempt, route: input.route,
      priceVersion: estimate.priceVersion, inputTokens: input.inputTokens, outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens, costMicros: estimate.costMicros, priced: true,
      status: input.status } as RunEventInput)
  }

  approveOverrun(runId: string, budgetId: string, extraMicros: number, approvalId: string, approver: string): void {
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/budget/${budgetId}/overrun/${approvalId}`,
      type: 'BUDGET_OVERRUN_APPROVED', runId: FusionRunId(runId), budgetId, extraMicros,
      approvalId, approver } as RunEventInput)
  }

  get(budgetId: string) {
    return this.manager.getState().budgets[budgetId]
  }

  report(budgetId: string): BudgetReport {
    const budget = this.manager.getState().budgets[budgetId]
    if (!budget) throw new Error(`BUDGET_UNKNOWN: budget ${budgetId} does not exist`)
    return { hardCostMicros: budget.hardCostMicros, spentMicros: budget.spentMicros,
      reservedMicros: budget.reservedMicros, approvedOverrunMicros: budget.approvedOverrunMicros,
      remainingMicros: budget.hardCostMicros + budget.approvedOverrunMicros
        - budget.spentMicros - budget.reservedMicros,
      openReservations: budget.openReservations }
  }

  private append(runId: FusionRunIdBrand, input: RunEventInput): void {
    const current = this.manager.getRun(runId)
    if (!current) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    this.manager.append(input, current.revision)
  }
}
