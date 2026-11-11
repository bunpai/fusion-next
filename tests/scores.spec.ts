import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2, openFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { BudgetService, type PriceTable } from '../src/budget/index.js'
import { ModelScoreService, wilsonLowerBound } from '../src/scores/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-j01-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const routeA: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const routeB: ModelRoute = { provider: 'beta', model: 'b1', capabilityDigest: 'digest-b' }
const prices: PriceTable = {
  priceOf: (route) => route.model === 'a1'
    ? { inputMicrosPerToken: 10, outputMicrosPerToken: 20, priceVersion: 'v1' }
    : { inputMicrosPerToken: 5, outputMicrosPerToken: 10, priceVersion: 'v1' },
}

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
const rev = (manager: RunManager) => {
  const current = manager.getRun(run)
  if (!current) throw new Error('test bug: run missing')
  return current.revision
}

function seeded(): { file: string; manager: RunManager; budgets: BudgetService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const budgets = new BudgetService(manager, prices)
  budgets.reserve(run, 'budget-1', 100_000)
  return { file, manager, budgets }
}

function settle(manager: RunManager, budgets: BudgetService, route: ModelRoute, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', index: number): void {
  budgets.reserveCall(run, 'budget-1', `res-${index}`, 1000)
  budgets.settle(run, 'budget-1', { reservationId: `res-${index}`, providerRequestId: `req-${index}`, attempt: 0, route,
    inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, status })
}

describe('J01 model score statistics with confidence and failure accounting', () => {
  it('counts successes, failures and cancellations in the denominator', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      for (let i = 0; i < 5; i += 1) settle(manager, budgets, routeA, i < 3 ? 'COMPLETED' : 'FAILED', i)
      settle(manager, budgets, routeA, 'CANCELLED', 5)
      const scores = new ModelScoreService(manager)
      const stats = scores.scoreOf('alpha', 'a1')
      expect(stats.attempts).toBe(6)
      expect(stats.successes).toBe(3)
      expect(stats.failures).toBe(2)
      expect(stats.cancelled).toBe(1)
      // Failures count in the denominator: 3/6, not 3/4.
      expect(stats.successRate).toBeCloseTo(0.5, 5)
    } finally { manager.close() }
  })

  it('refuses to rank small samples as confident (no overfitting to tiny history)', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      for (let i = 0; i < 3; i += 1) settle(manager, budgets, routeA, 'COMPLETED', i)
      const scores = new ModelScoreService(manager)
      const stats = scores.scoreOf('alpha', 'a1')
      expect(stats.attempts).toBe(3)
      expect(stats.sampleSufficient).toBe(false)
      expect(scores.rank().map((entry) => `${entry.provider}/${entry.model}`)).toEqual([])
      void budgets
    } finally { manager.close() }
  })

  it('ranks sufficient samples by Wilson lower-bound confidence', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      for (let i = 0; i < 10; i += 1) settle(manager, budgets, routeA, i < 9 ? 'COMPLETED' : 'FAILED', i)
      for (let i = 10; i < 20; i += 1) settle(manager, budgets, routeB, i < 15 ? 'COMPLETED' : 'FAILED', i)
      const scores = new ModelScoreService(manager)
      // Both 0.9 and 0.5 raw rates; Wilson lower separates them in the same direction.
      const ranked = scores.rank()
      expect(ranked[0].provider).toBe('alpha')
      expect(ranked[1].provider).toBe('beta')
      expect(ranked[0].confidence).toBeGreaterThan(ranked[1].confidence)
      expect(wilsonLowerBound(1, 1)).toBeGreaterThan(0)
      expect(wilsonLowerBound(1, 1)).toBeLessThan(0.25)
    } finally { manager.close() }
  })

  it('restores score statistics after restart', () => {
    const world = seeded()
    const { manager, budgets, file } = world
    try {
      for (let i = 0; i < 4; i += 1) settle(manager, budgets, routeA, 'COMPLETED', i)
      settle(manager, budgets, routeA, 'FAILED', 4)
      manager.close()
      const reopened = openRunManager(file)
      try {
        const stats = new ModelScoreService(reopened).scoreOf('alpha', 'a1')
        expect(stats.attempts).toBe(5)
        expect(stats.successes).toBe(4)
        expect(stats.failures).toBe(1)
      } finally { reopened.close() }
      void rev
    } finally { void budgets }
  })
})
