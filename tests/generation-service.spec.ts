import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry } from '../src/generation/service.js'
import { EffectLedger, effectFingerprint } from '../src/effects/ledger.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-d02-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const routeA: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const routeB: ModelRoute = { provider: 'beta', model: 'b1', capabilityDigest: 'digest-b' }

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

function seeded(): { manager: RunManager; service: GenerationService; registry: RouteCapabilityRegistry; ledger: EffectLedger } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' })
  registry.declare('beta', 'b1', { tools: false, contextWindow: 400_000, capabilityDigest: 'digest-b' })
  const service = new GenerationService(manager, rc5(), registry)
  return { manager, service, registry, ledger: new EffectLedger(manager) }
}

const prepared = (manager: RunManager, id: string) => manager.getState().generations[id]?.status

describe('D02 session generation, route capability, stale callback fencing', () => {
  it('T08/T09: rejects undeclared routes and unmet capability requirements before any event', () => {
    const { manager, service } = seeded()
    try {
      const revision = rev(manager)
      expect(() => service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'),
        { provider: 'ghost', model: 'x', capabilityDigest: 'd' }, {})).toThrow(/ROUTE_CAPABILITY_REJECTED/)
      expect(() => service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeB, { requireTools: true }))
        .toThrow(/does not support the required tool surface/)
      expect(() => service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, { minContextTokens: 300_000 }))
        .toThrow(/context window 100000 < required 300000/)
      expect(() => service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, { capabilityDigest: 'other' }))
        .toThrow(/does not satisfy required other/)
      expect(rev(manager)).toBe(revision)
      expect(manager.listEvents(run)).toHaveLength(2)
    } finally { manager.close() }
  })

  it('prepares and activates a capable generation with epoch tracking', () => {
    const { manager, service } = seeded()
    try {
      expect(service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, {})).toEqual({ generationId: 'g1', epoch: 1 })
      expect(prepared(manager, 'g1')).toBe('PREPARING')
      service.activate(run, AgentGenerationId('g1'))
      expect(prepared(manager, 'g1')).toBe('ACTIVE')
      expect(manager.getRun(run)?.currentGenerationIds).toEqual({ 'agent-1': 'g1' })
      // A committed-but-unacknowledged activation retries as a no-op.
      service.activate(run, AgentGenerationId('g1'))
      expect(manager.listEvents(run)).toHaveLength(4)
    } finally { manager.close() }
  })

  it('T14: a late callback from a retired generation is fenced and commits nothing', () => {
    const { manager, service } = seeded()
    try {
      service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, {})
      service.activate(run, AgentGenerationId('g1'))
      service.switchGeneration(run, 'agent-1', AgentGenerationId('g1'),
        { generationId: AgentGenerationId('g2'), sessionId: 'native-2', route: routeA, requirements: {} })
      const before = manager.getState()
      expect(prepared(manager, 'g1')).toBe('RETIRED')
      expect(prepared(manager, 'g2')).toBe('ACTIVE')
      expect(() => service.callback(run, AgentGenerationId('g1'))).toThrow(/stale generation callback fenced/)
      const after = manager.getState()
      expect(after.revision).toBe(before.revision)
      expect(after.seq).toBe(before.seq)
      // Callback for the CURRENT generation is accepted.
      service.callback(run, AgentGenerationId('g2'))
      expect(manager.getRun(run)?.currentGenerationIds['agent-1']).toBe('g2')
    } finally { manager.close() }
  })

  it('T17: three consecutive switches stay atomic and keep a single current generation', () => {
    const { manager, service } = seeded()
    try {
      service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, {})
      service.activate(run, AgentGenerationId('g1'))
      for (const next of ['g2', 'g3', 'g4']) {
        service.switchGeneration(run, 'agent-1', AgentGenerationId(`g${Number(next[1]) - 1}`),
          { generationId: AgentGenerationId(next), sessionId: `native-${next}`, route: routeA, requirements: {} })
      }
      expect(manager.getRun(run)?.currentGenerationIds).toEqual({ 'agent-1': 'g4' })
      expect(Object.values(manager.getState().generations).map(g => `${g.id}:${g.status}`).sort())
        .toEqual(['g1:RETIRED', 'g2:RETIRED', 'g3:RETIRED', 'g4:ACTIVE'])
      expect(manager.foreignKeyViolations()).toEqual([])
    } finally { manager.close() }
  })

  it('aborts an uncommitted preparation and resumes a drained generation on cancel', () => {
    const { manager, service } = seeded()
    try {
      service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, {})
      service.activate(run, AgentGenerationId('g1'))
      // A replacement can only be prepared while the current generation is draining.
      service.drain(run, AgentGenerationId('g1'))
      service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g2'), routeA, {})
      expect(prepared(manager, 'g2')).toBe('PREPARING')
      service.abortPreparation(run, AgentGenerationId('g2'))
      expect(prepared(manager, 'g2')).toBe('RETIRED')
      expect(manager.getRun(run)?.currentGenerationIds['agent-1']).toBe('g1')
      // Cancel returns the still-current generation to ACTIVE.
      service.cancelDrain(run, AgentGenerationId('g1'))
      expect(prepared(manager, 'g1')).toBe('ACTIVE')
      // Epoch counts every prepared generation, aborted ones included.
      service.drain(run, AgentGenerationId('g1'))
      expect(service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g3'), routeA, {})).toEqual({ generationId: 'g3', epoch: 3 })
    } finally { manager.close() }
  })

  it('crash before commit leaves generation state untouched and the retry succeeds', () => {
    const { manager, service } = seeded()
    try {
      expect(() => service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, {},
        { beforeCommit: () => { throw new Error('boom') } })).toThrow(/boom/)
      expect(Object.keys(manager.getState().generations)).toEqual([])
      expect(rev(manager)).toBe(2)
      service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, {})
      expect(prepared(manager, 'g1')).toBe('PREPARING')
    } finally { manager.close() }
  })

  it('external effect receipts settle even when their generation was retired (evidence is not fenced)', () => {
    const { manager, service, ledger } = seeded()
    try {
      service.prepare(run, 'agent-1', 'native-1', AgentGenerationId('g1'), routeA, {})
      service.activate(run, AgentGenerationId('g1'))
      ledger.recordIntent(run, { effectId: 'fx-1', generationId: AgentGenerationId('g1'), toolCallId: 'call-1',
        effectClass: 'NEEDS_VERIFICATION', fingerprint: effectFingerprint('shell', {}, '/w'), idempotencyKey: 'k1' }, rev(manager))
      ledger.dispatch(run, 'fx-1', rev(manager))
      service.switchGeneration(run, 'agent-1', AgentGenerationId('g1'),
        { generationId: AgentGenerationId('g2'), sessionId: 'native-2', route: routeA, requirements: {} })
      // The receipt records evidence of an external effect and must NOT be fenced like model callbacks.
      ledger.recordReceipt(run, 'fx-1', 'receipt://late', 'SUCCEEDED', rev(manager))
      expect(manager.getState().effects['fx-1']).toMatchObject({ state: 'SETTLED', resolvedBy: 'receipt' })
      // ...while the model callback for g1 remains fenced.
      expect(() => service.callback(run, AgentGenerationId('g1'))).toThrow(/stale generation callback fenced/)
    } finally { manager.close() }
  })
})
