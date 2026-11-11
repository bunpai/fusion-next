import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { BudgetService, type PriceTable } from '../src/budget/index.js'
import { ModelScoreService } from '../src/scores/index.js'
import { PairOptimizer, type RoutePair } from '../src/optimizer/index.js'
import { CachePolicyService } from '../src/cache/index.js'
import { EffectLedger } from '../src/effects/ledger.js'
import { AgentManager } from '../src/agents/index.js'
import { AnalyticsService } from '../src/analytics/index.js'
import { probeHostCapabilities } from '../src/host-capabilities/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-k03-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const routeA: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const routeB: ModelRoute = { provider: 'beta', model: 'b1', capabilityDigest: 'digest-b' }
const routeC: ModelRoute = { provider: 'gamma', model: 'g1', capabilityDigest: 'digest-c' }
const prices: PriceTable = {
  priceOf: (route) => route.model === 'a1'
    ? { inputMicrosPerToken: 10, outputMicrosPerToken: 20, priceVersion: 'v1' }
    : route.model === 'b1'
      ? { inputMicrosPerToken: 5, outputMicrosPerToken: 10, priceVersion: 'v1' }
      : { inputMicrosPerToken: 1, outputMicrosPerToken: 2, priceVersion: 'v1' },
}

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
const rev = (manager: RunManager) => {
  const current = manager.getRun(run)
  if (!current) throw new Error('test bug: run missing')
  return current.revision
}

function seeded(): { file: string; manager: RunManager; budgets: BudgetService; agents: AgentManager } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  manager.append(event({ type: 'GENERATION_PREPARED', runId: run, agentId: 'agent-lead', generationId: AgentGenerationId('g-1'), sessionId: 'native-lead', route: routeA, epoch: 1 }, 'seed-gen'), 2)
  manager.append(event({ type: 'GENERATION_ACTIVATED', runId: run, agentId: 'agent-lead', generationId: AgentGenerationId('g-1') }, 'seed-gen-act'), 3)
  const budgets = new BudgetService(manager, prices)
  budgets.reserve(run, 'budget-1', 1_000_000)
  const agents = new AgentManager(manager, probe())
  return { file, manager, budgets, agents }
}

function probe() {
  return probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: {
    sessionRead: true, sessionFork: true, forkLineage: true, sessionRebind: true, rebindAtomic: true,
    lifecycleEvents: true, lifecycleOrdering: true, approvalRequest: true, approvalTurnOpen: true,
    compactionControl: true, compactionTransaction: true, effectObservation: true,
    effectOutcomeKnown: true, effectIdempotency: true } })
}

function settle(budgets: BudgetService, route: ModelRoute, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', index: number): void {
  budgets.reserveCall(run, 'budget-1', `res-${index}`, 1000)
  budgets.settle(run, 'budget-1', { reservationId: `res-${index}`, providerRequestId: `req-${index}`, attempt: 0, route,
    inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, status })
}

describe('K03 analytics: usage audit, model combinations, cache net savings and audit export', () => {
  it('audits usage per route and reconciles with the budget report', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      for (let i = 0; i < 3; i += 1) settle(budgets, routeA, 'COMPLETED', i)
      settle(budgets, routeB, 'FAILED', 3)
      settle(budgets, routeB, 'CANCELLED', 4)
      const analytics = new AnalyticsService(manager, new ModelScoreService(manager))
      const audit = analytics.usageAudit(run)
      expect(audit.calls).toBe(5)
      expect(audit.completed).toBe(3)
      expect(audit.failed).toBe(1)
      expect(audit.cancelled).toBe(1)
      // a1: 3 * (100*10 + 50*20) = 6000µ; b1 failed/cancelled cost nothing.
      expect(audit.spentMicros).toBe(6000)
      const report = budgets.report('budget-1')
      expect(report.spentMicros).toBe(audit.spentMicros)
      // perRoute counts the quoted cost of every settled attempt (failed calls may still be
      // billed); audit.spentMicros counts only completed spend and reconciles with the budget.
      expect(audit.perRoute).toEqual([
        { route: 'alpha/a1', calls: 3, costMicros: 6000 },
        { route: 'beta/b1', calls: 2, costMicros: 2000 },
      ])
    } finally { manager.close() }
  })

  it('reports cache net savings and flags losing keepalive entries', () => {
    const world = seeded()
    const { manager } = world
    try {
      const cache = new CachePolicyService(manager)
      cache.record(run, AgentGenerationId('g-1'), 'cache-win', { savedCostMicros: 10_000, keepaliveCostMicros: 0, expireAt: 99_999_999_999, policyVersion: 'p1' })
      cache.record(run, AgentGenerationId('g-1'), 'cache-loss', { savedCostMicros: 100, keepaliveCostMicros: 900, expireAt: 99_999_999_999, policyVersion: 'p1' })
      const analytics = new AnalyticsService(manager, new ModelScoreService(manager))
      const net = analytics.cacheNetSavings(run)
      expect(net).toEqual({ savedCostMicros: 10_100, keepaliveCostMicros: 900, netSavingsMicros: 9_200, losingEntries: ['cache-loss'] })
    } finally { manager.close() }
  })

  it('keeps failures visible: failed reports, unresolved effects and repair states', () => {
    const world = seeded()
    const { manager, budgets, agents } = world
    try {
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-lead', brief: { objective: 'do', constraints: [], contextRefs: [] }, writeScope: [] })
      agents.report(run, { reportId: 'r-1', assignmentId: 'a-1', generationId: AgentGenerationId('g-1'), summary: 'broke', status: 'FAILED', artifacts: [] })
      agents.fail(run, 'a-1', 'r-1')
      const ledger = new EffectLedger(manager)
      ledger.recordIntent(run, { effectId: 'fx-1', generationId: AgentGenerationId('g-1'), toolCallId: 'call-1',
        effectClass: 'NEVER_RETRY', fingerprint: 'fp', idempotencyKey: 'k-1' }, rev(manager))
      ledger.dispatch(run, 'fx-1', rev(manager))
      ledger.markUnresolved(run, 'fx-1', rev(manager))
      settle(budgets, routeA, 'FAILED', 0)
      const analytics = new AnalyticsService(manager, new ModelScoreService(manager))
      const failures = analytics.failureReport(run)
      expect(failures.failedAssignments).toEqual(['a-1'])
      expect(failures.needsRepairEffects).toEqual(['fx-1'])
      expect(failures.failedCalls).toBe(1)
      expect(failures.runsInRepair).toEqual([])
    } finally { manager.close() }
  })

  it('ranks model combinations through the pair optimizer', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      for (let i = 0; i < 5; i += 1) settle(budgets, routeA, 'COMPLETED', i)
      for (let i = 5; i < 10; i += 1) settle(budgets, routeB, 'COMPLETED', i)
      const scores = new ModelScoreService(manager)
      const optimizer = new PairOptimizer(scores, prices)
      const analytics = new AnalyticsService(manager, scores, optimizer)
      const pairs: RoutePair[] = [
        { name: 'solid-expensive', primary: routeA, fallback: routeA },
        { name: 'solid-cheap', primary: routeB, fallback: routeB },
      ]
      const best = analytics.bestModelCombination(pairs, { minConfidence: 0.5, usage: { inputTokens: 1000, outputTokens: 500 } })
      expect(best?.pair.name).toBe('solid-cheap')
    } finally { manager.close() }
  })

  it('exports a deterministic audit bundle whose digest survives restart', () => {
    const world = seeded()
    const { manager, budgets, agents, file } = world
    try {
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-lead', brief: { objective: 'do', constraints: [], contextRefs: [] }, writeScope: [] })
      agents.report(run, { reportId: 'r-1', assignmentId: 'a-1', generationId: AgentGenerationId('g-1'), summary: 'broke', status: 'FAILED', artifacts: [] })
      settle(budgets, routeA, 'COMPLETED', 0)
      const first = new AnalyticsService(manager, new ModelScoreService(manager)).auditExport(run)
      expect(first.digest).toMatch(/^audit-[0-9a-f]{16}$/)
      expect(first.bundle.failures.failedReports).toEqual(['r-1'])
      manager.close()
      const reopened = openRunManager(file)
      try {
        const second = new AnalyticsService(reopened, new ModelScoreService(reopened)).auditExport(run)
        expect(second.digest).toBe(first.digest)
      } finally { reopened.close() }
    } finally { void budgets }
  })
})
