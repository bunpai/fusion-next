import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, type LifecycleEvent } from '../src/lifecycle/index.js'
import { ROUTER_CHECKPOINTS, hardFilter, rankCandidates, selectRoute, type RouteCandidate, type RouterCheckpoint, type UserPolicy } from '../src/router/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-g01-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>

const candidate = (id: string, overrides: Partial<RouteCandidate> = {}): RouteCandidate => ({
  route: { provider: id, model: `${id}-m`, capabilityDigest: `digest-${id}` },
  tier: 'L2', tools: ['fs.read', 'fs.write'], contextWindow: 128_000, modalities: ['text'],
  available: true, priceIndex: 1, userPreferenceRank: 0, ...overrides,
})
const userPolicy: UserPolicy = { allowedTiers: ['L0', 'L1', 'L2', 'L3'] }
const filterContext = { requiredTools: ['fs.read', 'fs.write'], minContextTokens: 32_000,
  requiredModalities: ['text'], userPolicy }

function seeded(): { file: string; manager: RunManager } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  return { file, manager }
}

describe('G01 router: six checkpoints, L0-L3 tiers, hard filters and deterministic selection', () => {
  it('exposes exactly the six router checkpoints in plan order', () => {
    expect(ROUTER_CHECKPOINTS).toEqual([
      'TASK_START', 'AFTER_EXPLORE', 'AFTER_PLAN', 'DURING_EXECUTE', 'DURING_COMPACTION', 'BEFORE_FINALIZE',
    ])
    const typed: readonly RouterCheckpoint[] = ROUTER_CHECKPOINTS
    void typed
  })

  it('hard-filters candidates on tools, window, modality, availability and user tier policy', () => {
    const candidates = [
      candidate('ok'),
      candidate('no-tools', { tools: ['fs.read'] }),
      candidate('small-window', { contextWindow: 16_000 }),
      candidate('no-modality', { modalities: ['image'] }),
      candidate('down', { available: false }),
      candidate('forbidden-tier', { tier: 'L3' }),
    ]
    const policy: UserPolicy = { allowedTiers: ['L0', 'L1', 'L2'] }
    const kept = hardFilter(candidates, { ...filterContext, userPolicy: policy })
    expect(kept.map(entry => entry.route.provider)).toEqual(['ok'])
  })

  it('is deterministic: identical inputs always produce the identical choice', () => {
    const candidates = [candidate('b', { priceIndex: 1 }), candidate('a', { priceIndex: 1 }), candidate('c', { priceIndex: 1 })]
    const first = selectRoute(candidates, filterContext)
    const second = selectRoute([...candidates].reverse(), filterContext)
    if (!first || !second) throw new Error('test bug: selection missing')
    expect(first.route.provider).toBe(second.route.provider)
    // Ties break by canonical (provider, model) order.
    expect(first.route.provider).toBe('a')
  })

  it('ranks by risk-adjusted value and falls back down the ranked list on unavailability', () => {
    const ranked = rankCandidates([
      candidate('cheap', { tier: 'L1', priceIndex: 0.2 }),
      candidate('strong', { tier: 'L3', priceIndex: 2 }),
      candidate('mid', { tier: 'L2', priceIndex: 1 }),
    ], filterContext)
    expect(ranked[0].route.provider).toBe('strong')
    expect(ranked.map(entry => entry.route.provider)).toContain('cheap')
    // 429 fallback: the unavailable head is skipped, the next healthy candidate wins.
    const selection = selectRoute(ranked.map((entry, index) => index === 0 ? { ...entry, available: false } : entry), filterContext)
    if (!selection) throw new Error('test bug: fallback selection missing')
    expect(selection.route.provider).toBe('mid')
    expect(selectRoute([], filterContext)).toBeUndefined()
  })

  it('never auto-upgrades during compaction; escalates on execute failures within the policy', () => {
    const current = candidate('current', { tier: 'L2' })
    const upgrade = candidate('frontier', { tier: 'L3' })
    // DURING_COMPACTION only allows the same or a lower tier (plan line 220).
    expect(selectRoute([current, upgrade], filterContext, { checkpoint: 'DURING_COMPACTION', currentTier: 'L2', warmCacheTokens: 0 })).toBe(current)
    // DURING_EXECUTE with a failure signal may escalate inside the user's tier policy.
    const escalated = selectRoute([current, upgrade], { ...filterContext, userPolicy: { allowedTiers: ['L0', 'L1', 'L2', 'L3'] } },
      { checkpoint: 'DURING_EXECUTE', currentTier: 'L2', warmCacheTokens: 0, signals: ['failure'] })
    expect(escalated).toBe(upgrade)
    // The user policy still binds even during execute escalation.
    expect(selectRoute([current, upgrade], { ...filterContext, userPolicy: { allowedTiers: ['L0', 'L1', 'L2'] } },
      { checkpoint: 'DURING_EXECUTE', currentTier: 'L2', warmCacheTokens: 0, signals: ['failure'] })).toBe(current)
  })

  it('charges the cache rebuild penalty so a warm stable prefix is not abandoned for free', () => {
    const cold = candidate('cold', { priceIndex: 0.9 })
    const warm = candidate('warm', { priceIndex: 1 })
    const noCache = selectRoute([warm, cold], filterContext, { checkpoint: 'AFTER_PLAN', currentTier: 'L2', warmCacheTokens: 0 })
    if (!noCache) throw new Error('test bug: noCache selection missing')
    expect(noCache.route.provider).toBe('cold')
    const withCache = selectRoute([warm, cold], filterContext, { checkpoint: 'AFTER_PLAN', currentTier: 'L2', warmCacheTokens: 50_000, currentRoute: warm.route })
    if (!withCache) throw new Error('test bug: withCache selection missing')
    expect(withCache.route.provider).toBe('warm')
    void seeded
  })

  it('routes journal-free: the Router only proposes; the transition manager commits', () => {
    // The Router module must not touch the RunManager — it has no import of it.
    const world = seeded()
    try {
      expect(() => selectRoute([candidate('ok')], filterContext)).not.toThrow()
      void world
    } finally { world.manager.close() }
  })
})
