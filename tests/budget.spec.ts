import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2, openFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { BudgetService, type PriceTable } from '../src/budget/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-g02-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const priced: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const unpriced: ModelRoute = { provider: 'beta', model: 'b1', capabilityDigest: 'digest-b' }

const prices: PriceTable = {
  priceOf: route => route.provider === 'alpha'
    ? { inputMicrosPerToken: 10, outputMicrosPerToken: 20, cachedReadMicrosPerToken: 2, priceVersion: 'v1' }
    : undefined,
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
  return { file, manager, budgets: new BudgetService(manager, prices) }
}

describe('G02 cost/budget reservation, pricing and overrun approval', () => {
  it('prices known routes exactly and treats unknown prices as UNPRICED, never free', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      budgets.reserve(run, 'budget-1', 10_000)
      const estimate = budgets.estimate(priced, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200 })
      if (!estimate.priced) throw new Error('test bug: priced route estimated unpriced')
      expect(estimate.costMicros).toBe(1000 * 10 + 500 * 20 + 200 * 2)
      const unknown = budgets.estimate(unpriced, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0 })
      expect(unknown.priced).toBe(false)
      void manager
    } finally { manager.close() }
  })

  it('rejects an unpriced settlement before any event (unknown price is not free)', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      budgets.reserve(run, 'budget-1', 10_000)
      expect(() => budgets.settle(run, 'budget-1', { reservationId: 'res-x', providerRequestId: 'pr-1', attempt: 0,
        route: unpriced, inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, status: 'COMPLETED' }))
        .toThrow(/UNPRICED/)
      expect(Object.keys(manager.getState().budgets['budget-1']?.openReservations ?? {})).toEqual([])
    } finally { manager.close() }
  })

  it('enforces the cap at reservation and at settlement: unauthorized overrun is impossible', () => {
    const world = seeded()
    const { manager, budgets } = world
    try {
      budgets.reserve(run, 'budget-1', 10_000)
      budgets.reserveCall(run, 'budget-1', 'res-1', 6_000)
      expect(() => budgets.reserveCall(run, 'budget-1', 'res-2', 6_000))
        .toThrow(/budget reservation exceeds cap/)
      budgets.settle(run, 'budget-1', { reservationId: 'res-1', providerRequestId: 'pr-1', attempt: 0,
        route: priced, inputTokens: 300, outputTokens: 100, cacheReadTokens: 50, status: 'COMPLETED' })
      // 300*10 + 100*20 + 50*2 = 5100; spent 5100, reserved back to 0.
      expect(budgets.report('budget-1')).toMatchObject({ spentMicros: 5100, reservedMicros: 0 })
      budgets.reserveCall(run, 'budget-1', 'res-2', 5_000)
      // 350*10 + 100*20 = 5500; 5100 + 5500 = 10600 > cap 10000 → rejected, nothing leaks.
      expect(() => budgets.settle(run, 'budget-1', { reservationId: 'res-2', providerRequestId: 'pr-2', attempt: 0,
        route: priced, inputTokens: 350, outputTokens: 100, cacheReadTokens: 0, status: 'COMPLETED' }))
        .toThrow(/budget settlement exceeds cap/)
      // Nothing from the rejected settlement leaked into the ledger.
      expect(budgets.report('budget-1')).toMatchObject({ spentMicros: 5100, reservedMicros: 5000 })
    } finally { manager.close() }
  })

  it('unlocks only the explicitly approved overrun, never more', () => {
    const world = seeded()
    const { budgets } = world
    try {
      budgets.reserve(run, 'budget-1', 10_000)
      budgets.approveOverrun(run, 'budget-1', 2_000, 'approval-1', 'user')
      budgets.reserveCall(run, 'budget-1', 'res-1', 12_000)
      budgets.settle(run, 'budget-1', { reservationId: 'res-1', providerRequestId: 'pr-1', attempt: 0,
        route: priced, inputTokens: 400, outputTokens: 400, cacheReadTokens: 0, status: 'COMPLETED' })
      // 400*10 + 400*20 = 12000 <= 10000 + 2000 approved.
      expect(budgets.report('budget-1')).toMatchObject({ spentMicros: 12_000, approvedOverrunMicros: 2_000 })
      budgets.reserveCall(run, 'budget-1', 'res-2', 1_000)
      expect(() => budgets.settle(run, 'budget-1', { reservationId: 'res-2', providerRequestId: 'pr-2', attempt: 0,
        route: priced, inputTokens: 60, outputTokens: 20, cacheReadTokens: 0, status: 'COMPLETED' }))
        .toThrow(/budget settlement exceeds cap/)
    } finally { world.manager.close() }
  })

  it('releases a failed reservation without recording spend', () => {
    const world = seeded()
    const { budgets } = world
    try {
      budgets.reserve(run, 'budget-1', 10_000)
      budgets.reserveCall(run, 'budget-1', 'res-1', 4_000)
      budgets.settle(run, 'budget-1', { reservationId: 'res-1', providerRequestId: 'pr-1', attempt: 0,
        route: priced, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, status: 'FAILED' })
      expect(budgets.report('budget-1')).toMatchObject({ spentMicros: 0, reservedMicros: 0 })
      expect(budgets.report('budget-1').openReservations).toEqual({})
    } finally { world.manager.close() }
  })

  it('restores budgets from the journal after restart and projects usage rows', () => {
    const world = seeded()
    const { manager, budgets, file } = world
    try {
      budgets.reserve(run, 'budget-1', 10_000)
      budgets.reserveCall(run, 'budget-1', 'res-1', 6_000)
      budgets.settle(run, 'budget-1', { reservationId: 'res-1', providerRequestId: 'pr-1', attempt: 0,
        route: priced, inputTokens: 300, outputTokens: 100, cacheReadTokens: 50, status: 'COMPLETED' })
      manager.close()
      const reopened = openRunManager(file)
      try {
        expect(new BudgetService(reopened, prices).report('budget-1')).toMatchObject({ spentMicros: 5100 })
        const db = openFusionV2(file)
        try {
          const usage = db.prepare('SELECT cost, status FROM fusion_usage WHERE provider_request_id = ?').get('pr-1') as { cost: number; status: string } | undefined
          expect(usage).toBeDefined()
          expect(usage?.status).toBe('COMPLETED')
          const budget = db.prepare('SELECT spent, reserved FROM fusion_budgets WHERE budget_id = ?').get('budget-1') as { spent: number; reserved: number } | undefined
          expect(budget).toBeDefined()
          expect(budget?.spent).toBeCloseTo(5100 / 1_000_000)
        } finally { db.close() }
      } finally { reopened.close() }
    } finally { void manager }
  })
})
