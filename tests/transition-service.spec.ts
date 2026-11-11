import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateFusionV2, openFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type CapabilityRequirements } from '../src/generation/service.js'
import { EffectLedger, effectFingerprint } from '../src/effects/ledger.js'
import { TransitionService, type TransitionRequestSpec } from '../src/transition/service.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-d03-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const routeA: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const routeB: ModelRoute = { provider: 'beta', model: 'b1', capabilityDigest: 'digest-b' }
const noReqs: CapabilityRequirements = {}

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
const generationStatus = (manager: RunManager, id: string) => manager.getState().generations[id]?.status

function seeded(): { file: string; manager: RunManager; generations: GenerationService; ledger: EffectLedger; transitions: TransitionService; registry: RouteCapabilityRegistry } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' })
  registry.declare('beta', 'b1', { tools: false, contextWindow: 400_000, capabilityDigest: 'digest-b' })
  const generations = new GenerationService(manager, rc5(), registry)
  const ledger = new EffectLedger(manager)
  const transitions = new TransitionService(manager, rc5(), generations, ledger, registry)
  return { file, manager, generations, ledger, transitions, registry }
}

function seedActiveGeneration(world: { manager: RunManager; generations: GenerationService; ledger?: unknown; transitions?: unknown; registry?: unknown }, generationId = 'g1'): void {
  const { manager, generations } = world
  generations.prepare(run, 'agent-1', 'native-1', AgentGenerationId(generationId), routeA, {})
  generations.activate(run, AgentGenerationId(generationId))
  expect(generationStatus(manager, generationId)).toBe('ACTIVE')
}

const spec = (overrides: Partial<TransitionRequestSpec> = {}): TransitionRequestSpec => ({
  transitionId: 'tr-1', agentId: 'agent-1', mode: 'MANUAL',
  fromGenerationId: AgentGenerationId('g1'),
  to: { generationId: AgentGenerationId('g2'), sessionId: 'native-2', route: routeB, requirements: noReqs },
  ...overrides,
})

describe('D03 transition manager: PREPARE/COMMIT/ROLLBACK/REPAIR with per-step crash recovery', () => {
  it('rejects an incapable target route before appending any event and keeps the old run untouched', () => {
    const world = seeded()
    const { manager, transitions, generations, ledger } = world
    try {
      seedActiveGeneration(world)
      // A registry with no declared routes: even an all-true capability report cannot make an
      // undeclared route admissible (T03/T08).
      const demanding = new RouteCapabilityRegistry()
      const service = new TransitionService(manager, rc5(), new GenerationService(manager, rc5(), demanding), new EffectLedger(manager), demanding)
      const before = manager.getState()
      const result = service.request(run, spec({ to: { generationId: AgentGenerationId('g2'), sessionId: 'native-2', route: routeB, requirements: { requireTools: true } } }))
      expect(result.outcome).toBe('REJECTED')
      if (result.outcome !== 'REJECTED') throw new Error('unreachable')
      expect(result.reason).toMatch(/ROUTE_CAPABILITY_REJECTED/)
      expect(manager.getState().revision).toBe(before.revision)
      expect(manager.listEvents(run)).toHaveLength(4)
    } finally { manager.close() }
  })

  it('requires REPAIR for unsettled effects and completes only after reconciliation', () => {
    const { manager, transitions, ledger, generations } = seeded()
    try {
      seedActiveGeneration({ manager, generations, ledger, transitions, registry: new RouteCapabilityRegistry() })
      ledger.recordIntent(run, { effectId: 'fx-1', generationId: AgentGenerationId('g1'), toolCallId: 'call-1',
        effectClass: 'NEEDS_VERIFICATION', fingerprint: effectFingerprint('shell', {}, '/w'), idempotencyKey: 'k1' }, rev(manager))
      ledger.dispatch(run, 'fx-1', rev(manager))
      const blocked = transitions.request(run, spec())
      expect(blocked.outcome).toBe('REPAIR_REQUIRED')
      if (blocked.outcome !== 'REPAIR_REQUIRED') throw new Error('unreachable')
      expect(blocked.blockers).toEqual(['effects:fx-1:EXECUTING'])
      expect(manager.listEvents(run)).toHaveLength(6) // seed x2 + prepare + activate + intent + dispatch
      // Unknown-outcome reconciliation path: unresolved then verified reconcile, then the switch succeeds.
      ledger.markUnresolved(run, 'fx-1', rev(manager))
      ledger.reconcile(run, 'fx-1', 'receipt://verified', 'SUCCEEDED', rev(manager))
      const result = transitions.request(run, spec())
      expect(result.outcome).toBe('COMMITTED')
      expect(generationStatus(manager, 'g1')).toBe('RETIRED')
      expect(generationStatus(manager, 'g2')).toBe('ACTIVE')
    } finally { manager.close() }
  })

  it('commits a manual transition and journals every phase', () => {
    const world = seeded()
    const { manager, transitions, generations, file } = world
    try {
      seedActiveGeneration(world)
      const result = transitions.request(run, spec())
      expect(result.outcome).toBe('COMMITTED')
      expect(manager.getState().transitions['tr-1']).toMatchObject({ phase: 'COMMITTED', transitionId: 'tr-1' })
      expect(generationStatus(manager, 'g1')).toBe('RETIRED')
      expect(generationStatus(manager, 'g2')).toBe('ACTIVE')
      expect(manager.getRun(run)?.currentGenerationIds['agent-1']).toBe('g2')
      const db = new DatabaseSync(file)
      const row = db.prepare('SELECT phase, from_gen, to_gen, agent_id FROM fusion_transitions WHERE id = ?').get('tr-1') as
        { phase: string; from_gen: string; to_gen: string; agent_id: string } | undefined
      db.close()
      expect(row).toMatchObject({ phase: 'COMMITTED', from_gen: 'g1', to_gen: 'g2', agent_id: 'agent-1' })
    } finally { manager.close() }
  })

  it('T11: crash after checkpoint resumes idempotently on retry', () => {
    const { manager, transitions, generations } = seeded()
    try {
      seedActiveGeneration({ manager, generations, ledger: new EffectLedger(manager), transitions, registry: new RouteCapabilityRegistry() })
      const checkpointedRevision = rev(manager)
      expect(() => transitions.request(run, spec(), { crashAfter: 'checkpoint' })).toThrow(/injected crash after transition checkpoint/)
      // Checkpoint marker is durable, nothing else moved.
      expect(manager.getState().transitions['tr-1']).toMatchObject({ phase: 'CHECKPOINTED' })
      expect(generationStatus(manager, 'g1')).toBe('ACTIVE')
      expect(rev(manager)).toBe(checkpointedRevision + 1)
      // Retry with the same spec resumes and completes.
      const result = transitions.request(run, spec())
      expect(result.outcome).toBe('COMMITTED')
      expect(generationStatus(manager, 'g2')).toBe('ACTIVE')
      expect(manager.getState().transitions['tr-1'].phase).toBe('COMMITTED')
      // A second retry after commit is a pure no-op (idempotent resume).
      const eventsBefore = manager.listEvents(run).length
      const again = transitions.request(run, spec())
      expect(again.outcome).toBe('COMMITTED')
      expect(manager.listEvents(run)).toHaveLength(eventsBefore)
    } finally { manager.close() }
  })

  it('T12/T13: crash after prepare leaves durable half-state and resumes to COMMITTED without re-dispatch', () => {
    const world = seeded()
    const { manager, transitions, generations, file } = world
    seedActiveGeneration(world)
    expect(() => transitions.request(run, spec(), { crashAfter: 'prepare' })).toThrow(/injected crash after generation prepare/)
    expect(generationStatus(manager, 'g1')).toBe('DRAINING')
    expect(generationStatus(manager, 'g2')).toBe('PREPARING')
    const events = manager.listEvents(run).map(e => e.type)
    expect(events).toContain('TRANSITION_CHECKPOINTED')
    expect(events).toContain('GENERATION_DRAINING')
    expect(events).toContain('GENERATION_PREPARED')
    expect(events).not.toContain('GENERATION_SWITCH_COMMITTED')
    // Reopen: journal replay alone reproduces the half-state.
    manager.close()
    const reopened = openRunManager(file)
    try {
      const resumedRegistry = new RouteCapabilityRegistry()
      resumedRegistry.declare('alpha', 'a1', { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' })
      resumedRegistry.declare('beta', 'b1', { tools: false, contextWindow: 400_000, capabilityDigest: 'digest-b' })
      const resumed = new TransitionService(reopened, rc5(), new GenerationService(reopened, rc5(), resumedRegistry), new EffectLedger(reopened), resumedRegistry)
      const result = resumed.request(run, spec())
      expect(result.outcome).toBe('COMMITTED')
      expect(generationStatus(reopened, 'g1')).toBe('RETIRED')
      expect(generationStatus(reopened, 'g2')).toBe('ACTIVE')
      expect(reopened.getRun(run)?.currentGenerationIds['agent-1']).toBe('g2')
    } finally { reopened.close() }
  })

  it('rolls back when the replacement cannot be prepared and restores the old generation', () => {
    const { manager, transitions, generations } = seeded()
    try {
      seedActiveGeneration({ manager, generations, ledger: new EffectLedger(manager), transitions, registry: new RouteCapabilityRegistry() })
      // Pre-burn the target generation id with an aborted preparation so the later prepare is rejected mid-flight.
      generations.drain(run, AgentGenerationId('g1'))
      generations.prepare(run, 'agent-1', 'native-burned', AgentGenerationId('g2'), routeB, {})
      generations.abortPreparation(run, AgentGenerationId('g2'))
      generations.cancelDrain(run, AgentGenerationId('g1'))
      expect(generationStatus(manager, 'g1')).toBe('ACTIVE')
      const result = transitions.request(run, spec())
      expect(result.outcome).toBe('ROLLED_BACK')
      if (result.outcome !== 'ROLLED_BACK') throw new Error('unreachable')
      expect(result.reason).toMatch(/generation id already exists/)
      expect(generationStatus(manager, 'g1')).toBe('ACTIVE')
      expect(generationStatus(manager, 'g2')).toBe('RETIRED')
      expect(manager.getState().transitions['tr-1']).toMatchObject({ phase: 'ROLLED_BACK' })
      expect(manager.foreignKeyViolations()).toEqual([])
    } finally { manager.close() }
  })

  it('transition ids are unique and phase events collapse idempotently', () => {
    const { manager, transitions, generations } = seeded()
    try {
      seedActiveGeneration({ manager, generations, ledger: new EffectLedger(manager), transitions, registry: new RouteCapabilityRegistry() })
      transitions.request(run, spec())
      expect(() => transitions.request(run, spec({ transitionId: 'tr-1', to: { generationId: AgentGenerationId('g3'), sessionId: 'native-3', route: routeA, requirements: {} } })))
        .toThrow(/transition id already exists|already/i)
    } finally { manager.close() }
  })
})
