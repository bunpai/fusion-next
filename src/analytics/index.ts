import { createHash } from 'node:crypto'
import type { RunManager } from '../run-manager/index.js'
import type { ModelScoreService } from '../scores/index.js'
import type { RankedPair } from '../optimizer/index.js'
import type { PairOptimizer, RankRequirements, RoutePair } from '../optimizer/index.js'

/** K03 analytics: usage audit (reconciled against the budget report), model combinations via the
 * J02 optimizer, cache net-savings accounting and a deterministic audit export. Failures are
 * always visible — failed assignments, unresolved effects, failed calls and runs in repair are
 * listed, never summarized away. The export digest is canonical-JSON based so it survives restart. */

export type UsageAudit = {
  runId?: string
  calls: number
  completed: number
  failed: number
  cancelled: number
  spentMicros: number
  perRoute: Array<{ route: string; calls: number; costMicros: number }>
}

export type CacheNetSavings = { savedCostMicros: number; keepaliveCostMicros: number; netSavingsMicros: number; losingEntries: string[] }

export type FailureReport = {
  failedAssignments: string[]
  failedReports: string[]
  needsRepairEffects: string[]
  failedCalls: number
  runsInRepair: string[]
}

export type AuditExport = { bundle: { runId: string; status: string; seq: number; usage: UsageAudit; failures: FailureReport; cacheNet: CacheNetSavings }; digest: string }

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
  }
  return item
})

export class AnalyticsService {
  constructor(private readonly manager: RunManager, private readonly scores: ModelScoreService,
    private readonly optimizer?: PairOptimizer) {}

  private usageEntries(runId?: string): Array<{ route: { provider: string; model: string }; costMicros: number; status: string }> {
    const state = this.manager.getState()
    const entries: Array<{ route: { provider: string; model: string }; costMicros: number; status: string }> = []
    for (const budget of Object.values(state.budgets)) {
      for (const entry of Object.values(budget.usage)) {
        if (runId !== undefined && entry.runId !== runId) continue
        entries.push({ route: entry.route, costMicros: entry.costMicros, status: entry.status })
      }
    }
    return entries
  }

  usageAudit(runId?: string): UsageAudit {
    const entries = this.usageEntries(runId)
    const perRoute = new Map<string, { calls: number; costMicros: number }>()
    let completed = 0
    let failed = 0
    let cancelled = 0
    let spentMicros = 0
    for (const entry of entries) {
      const key = `${entry.route.provider}/${entry.route.model}`
      const record = perRoute.get(key) ?? { calls: 0, costMicros: 0 }
      record.calls += 1
      record.costMicros += entry.costMicros
      perRoute.set(key, record)
      if (entry.status === 'COMPLETED') { completed += 1; spentMicros += entry.costMicros }
      else if (entry.status === 'FAILED') failed += 1
      else if (entry.status === 'CANCELLED') cancelled += 1
    }
    return { runId, calls: entries.length, completed, failed, cancelled, spentMicros,
      perRoute: [...perRoute.entries()].map(([route, record]) => ({ route, ...record })).sort((a, b) => a.route.localeCompare(b.route)) }
  }

  cacheNetSavings(runId: string): CacheNetSavings {
    const state = this.manager.getState()
    let savedCostMicros = 0
    let keepaliveCostMicros = 0
    const losingEntries: string[] = []
    for (const entry of Object.values(state.caches)) {
      if (entry.runId !== runId) continue
      savedCostMicros += entry.savedCostMicros
      keepaliveCostMicros += entry.keepaliveCostMicros
      if (entry.savedCostMicros - entry.keepaliveCostMicros <= 0) losingEntries.push(entry.cacheKey)
    }
    return { savedCostMicros, keepaliveCostMicros, netSavingsMicros: savedCostMicros - keepaliveCostMicros, losingEntries: losingEntries.sort() }
  }

  failureReport(runId?: string): FailureReport {
    const state = this.manager.getState()
    const inScope = (owner: string) => runId === undefined || owner === runId
    const failedAssignments: string[] = []
    const failedReports: string[] = []
    const needsRepairEffects: string[] = []
    const runsInRepair: string[] = []
    for (const assignment of Object.values(state.assignments)) {
      if (!inScope(assignment.runId)) continue
      if (assignment.status === 'FAILED') failedAssignments.push(assignment.assignmentId)
      if (assignment.lastReportId && state.reports[assignment.lastReportId]?.status === 'FAILED') failedReports.push(assignment.lastReportId)
    }
    for (const effect of Object.values(state.effects)) {
      if (!inScope(effect.runId)) continue
      if (effect.state === 'NEEDS_REPAIR') needsRepairEffects.push(effect.effectId)
    }
    for (const run of Object.values(state.runs)) {
      if (!inScope(run.id)) continue
      if (run.status === 'NEEDS_REPAIR') runsInRepair.push(run.id)
    }
    const failedCalls = this.usageEntries(runId).filter((entry) => entry.status === 'FAILED').length
    return { failedAssignments: failedAssignments.sort(), failedReports: failedReports.sort(),
      needsRepairEffects: needsRepairEffects.sort(), failedCalls, runsInRepair: runsInRepair.sort() }
  }

  bestModelCombination(pairs: readonly RoutePair[], requirements: RankRequirements): RankedPair | undefined {
    if (!this.optimizer) throw new Error('ANALYTICS_NO_OPTIMIZER: model combinations require the J02 pair optimizer')
    return this.optimizer.rankPairs(pairs, requirements)[0]
  }

  /** Deterministic audit bundle; the digest is over the canonical JSON so it is stable across restarts. */
  auditExport(runId: string): AuditExport {
    const state = this.manager.getState()
    const run = state.runs[runId]
    if (!run) throw new Error(`ANALYTICS_UNKNOWN_RUN: run ${runId} has no projection`)
    const bundle = {
      runId, status: run.status, seq: state.seq,
      usage: this.usageAudit(runId),
      failures: this.failureReport(runId),
      cacheNet: this.cacheNetSavings(runId),
    }
    const digest = `audit-${createHash('sha256').update(canonical(bundle)).digest('hex').slice(0, 16)}`
    return { bundle, digest }
  }
}
