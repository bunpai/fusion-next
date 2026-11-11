import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { BudgetService, type PriceTable } from '../src/budget/index.js'
import { ModelScoreService } from '../src/scores/index.js'
import { PairOptimizer, type RoutePair } from '../src/optimizer/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-j02-')); dirs.push(dir); return join(dir, 'fusion.db') }
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

function seeded(): { file: string; manager: RunManager; budgets: BudgetService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const budgets = new BudgetService(manager, prices)
  budgets.reserve(run, 'budget-1', 10_000_000)
  return { file, manager, budgets }
}

function settle(budgets: BudgetService, route: ModelRoute, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', index: number): void {
  budgets.reserveCall(run, 'budget-1', `res-${index}`, 1000)
  budgets.settle(run, 'budget-1', { reservationId: `res-${index}`, providerRequestId: `req-${index}`, attempt: 0, route,
    inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, status })
}

describe('J02 pair optimizer with cost/time prediction and A/B planning', () => {
  it('never recommends pairs whose legs lack sufficient confident samples (hard quality gate)', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      for (let i = 0; i < 5; i += 1) settle(budgets, routeA, 'COMPLETED', i)
      for (let i = 5; i < 10; i += 1) settle(budgets, routeB, 'COMPLETED', i)
      // routeC never measured.
      const optimizer = new PairOptimizer(new ModelScoreService(manager), prices)
      const pairs: RoutePair[] = [
        { name: 'measured', primary: routeA, fallback: routeB },
        { name: 'cheap-unmeasured', primary: routeC, fallback: routeB },
      ]
      const ranked = optimizer.rankPairs(pairs, { minConfidence: 0.5 })
      expect(ranked.map((entry) => entry.pair.name)).toEqual(['measured'])
      void manager
    } finally { manager.close() }
  })

  it('ranks sufficient pairs by predicted cost with confidence as the tiebreak', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      for (let i = 0; i < 5; i += 1) settle(budgets, routeA, 'COMPLETED', i)
      for (let i = 5; i < 10; i += 1) settle(budgets, routeB, 'COMPLETED', i)
      for (let i = 10; i < 15; i += 1) settle(budgets, routeC, i < 14 ? 'COMPLETED' : 'FAILED', i)
      const optimizer = new PairOptimizer(new ModelScoreService(manager), prices)
      const pairs: RoutePair[] = [
        { name: 'expensive-solid', primary: routeA, fallback: routeA },
        { name: 'cheap-also-solid', primary: routeB, fallback: routeB },
      ]
      const ranked = optimizer.rankPairs(pairs, { minConfidence: 0.5, usage: { inputTokens: 1000, outputTokens: 500 } })
      expect(ranked[0].pair.name).toBe('cheap-also-solid')
      expect(ranked[0].predictedCostMicros).toBeLessThan(ranked[1].predictedCostMicros)
    } finally { manager.close() }
  })

  it('reports unpriced legs as not estimable instead of treating them as free', () => {
    const world = seeded()
    const { manager } = world
    try {
      const optimizer = new PairOptimizer(new ModelScoreService(manager), { priceOf: () => undefined })
      const estimate = optimizer.estimatePairCost({ name: 'x', primary: routeA, fallback: routeB }, { inputTokens: 10, outputTokens: 10 })
      expect(estimate).toEqual({ priced: false })
    } finally { manager.close() }
  })

  it('guards A/B plans against the remaining budget and labels arms deterministically', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      budgets.reserveCall(run, 'budget-1', 'ab-1', 5_000_000)
      const optimizer = new PairOptimizer(new ModelScoreService(manager), prices)
      const pairA: RoutePair = { name: 'a', primary: routeA, fallback: routeB }
      const pairB: RoutePair = { name: 'b', primary: routeB, fallback: routeA }
      expect(() => optimizer.planAbTest(pairA, pairB, { remainingMicros: 8_000_000, perArmCostMicros: 5_000_000 }))
        .toThrow(/AB_TEST_BUDGET_EXCEEDED/)
      const plan = optimizer.planAbTest(pairA, pairB, { remainingMicros: 10_000_000, perArmCostMicros: 5_000_000 })
      expect(plan.arms.map((arm) => arm.label)).toEqual(['A', 'B'])
      expect(plan.arms[0].pair.name).toBe('a')
      expect(plan.totalCostMicros).toBe(10_000_000)
    } finally { manager.close() }
  })

  it('predicts duration only from operator-declared speeds and never guesses', () => {
    const world = seeded()
    const { manager } = world
    try {
      const optimizer = new PairOptimizer(new ModelScoreService(manager), prices,
        { speedOf: (route) => (route.model === 'a1' ? 100 : undefined) })
      expect(optimizer.predictDuration(routeA, 500)).toEqual({ estimable: true, durationMs: 5 })
      expect(optimizer.predictDuration(routeB, 500)).toEqual({ estimable: false,
        reason: 'no operator-declared speed for beta/b1; refusing to guess latency' })
    } finally { manager.close() }
  })
})
