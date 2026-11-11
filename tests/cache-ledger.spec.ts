import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2, openFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { CachePolicyService } from '../src/cache/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-g03-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const route: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const observedAllTrue: HostCapabilityInput['observed'] = {
  sessionRead: true, sessionFork: true, forkLineage: true, sessionRebind: true, rebindAtomic: true,
  lifecycleEvents: true, lifecycleOrdering: true, approvalRequest: true, approvalTurnOpen: true,
  compactionControl: true, compactionTransaction: true, effectObservation: true,
  effectOutcomeKnown: true, effectIdempotency: true,
}
const rc5 = () => probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: observedAllTrue })

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
const rev = (manager: RunManager) => {
  const current = manager.getRun(run)
  if (!current) throw new Error('test bug: run missing')
  return current.revision
}

function seeded(): { file: string; manager: RunManager; cache: CachePolicyService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  const capability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' }
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-lead', 'native-lead', AgentGenerationId('g-1'), route, {})
  generations.activate(run, AgentGenerationId('g-1'))
  return { file, manager, cache: new CachePolicyService(manager) }
}

describe('G03 cache ledger: keepalive accounting with automatic cost stop-loss', () => {
  it('records a cache entry, projects it into fusion_cache, and accumulates keepalive ticks within savings', () => {
    const world = seeded()
    const { manager, cache, file } = world
    try {
      cache.record(run, 'g-1', 'ctx-key', { savedCostMicros: 10_000, keepaliveCostMicros: 0, expireAt: 9_999_999_999_999, policyVersion: 'p1' })
      cache.keepaliveTick(run, 'g-1', 'ctx-key', { tickCostMicros: 1_000, idleSeconds: 10, ttlSeconds: 300, savingsRatio: 1.5, cachedTokens: 1000 })
      expect(cache.entry(run, 'g-1', 'ctx-key')).toMatchObject({ savedCostMicros: 10_000, keepaliveCostMicros: 1_000, active: true })
      manager.close()
      const reopened = openRunManager(file)
      try {
        const db = openFusionV2(file)
        try {
          const row = db.prepare('SELECT saved_cost, keepalive_cost, policy_version FROM fusion_cache WHERE cache_key = ?').get('ctx-key') as { saved_cost: number; keepalive_cost: number; policy_version: string } | undefined
          expect(row).toBeDefined()
          expect(row?.policy_version).toBe('p1')
          expect(row?.saved_cost).toBeCloseTo(10_000 / 1_000_000)
        } finally { db.close() }
      } finally { reopened.close() }
    } finally { void manager }
  })

  it('stops keepalive automatically once cumulative keepalive cost would exceed the savings (Q10)', () => {
    const world = seeded()
    const { cache } = world
    try {
      cache.record(run, 'g-1', 'ctx-key', { savedCostMicros: 2_000, keepaliveCostMicros: 0, expireAt: 9_999_999_999_999, policyVersion: 'p1' })
      cache.keepaliveTick(run, 'g-1', 'ctx-key', { tickCostMicros: 1_500, idleSeconds: 10, ttlSeconds: 300, savingsRatio: 1.5, cachedTokens: 1000 })
      // Next tick would push cumulative keepalive (1500+1500) past savings (2000) → auto stop BEFORE spending.
      expect(() => cache.keepaliveTick(run, 'g-1', 'ctx-key', { tickCostMicros: 1_500, idleSeconds: 20, ttlSeconds: 300, savingsRatio: 1.5, cachedTokens: 1000 }))
        .toThrow(/keepalive loses money/)
      expect(cache.entry(run, 'g-1', 'ctx-key')).toMatchObject({ keepaliveCostMicros: 1_500, active: false })
      expect(() => cache.keepaliveTick(run, 'g-1', 'ctx-key', { tickCostMicros: 100, idleSeconds: 30, ttlSeconds: 300, savingsRatio: 1.5, cachedTokens: 1000 }))
        .toThrow(/keepalive stopped/)
    } finally { world.manager.close() }
  })

  it('stops keepalive on expiry instead of paying for a dead entry', () => {
    const world = seeded()
    const { cache } = world
    try {
      cache.record(run, 'g-1', 'ctx-key', { savedCostMicros: 10_000, keepaliveCostMicros: 0, expireAt: 1_000, policyVersion: 'p1' })
      expect(() => cache.keepaliveTick(run, 'g-1', 'ctx-key', { tickCostMicros: 100, idleSeconds: 500, ttlSeconds: 300, savingsRatio: 1.5, cachedTokens: 1000 }))
        .toThrow(/expired/)
      expect(cache.entry(run, 'g-1', 'ctx-key')?.active).toBe(false)
    } finally { world.manager.close() }
  })

  it('restores cache entries from the journal after restart', () => {
    const world = seeded()
    const { manager, cache, file } = world
    try {
      cache.record(run, 'g-1', 'ctx-key', { savedCostMicros: 10_000, keepaliveCostMicros: 0, expireAt: 9_999_999_999_999, policyVersion: 'p1' })
      cache.keepaliveTick(run, 'g-1', 'ctx-key', { tickCostMicros: 2_000, idleSeconds: 10, ttlSeconds: 300, savingsRatio: 1.5, cachedTokens: 1000 })
      manager.close()
      const reopened = openRunManager(file)
      try {
        const restored = new CachePolicyService(reopened)
        expect(restored.entry(run, 'g-1', 'ctx-key')).toMatchObject({ savedCostMicros: 10_000, keepaliveCostMicros: 2_000, active: true })
      } finally { reopened.close() }
    } finally { void manager }
  })
})
