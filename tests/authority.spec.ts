import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type CapabilityRequirements } from '../src/generation/service.js'
import { EffectLedger } from '../src/effects/ledger.js'
import { TransitionService, type TransitionRequestSpec } from '../src/transition/service.js'
import { AuthorityService, type AuthoritySpec } from '../src/authority/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-d04-')); dirs.push(dir); return join(dir, 'fusion.db') }
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
const statusOf = (manager: RunManager, id: string) => manager.getState().generations[id]?.status

function makeRegistry(): RouteCapabilityRegistry {
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' })
  registry.declare('beta', 'b1', { tools: false, contextWindow: 400_000, capabilityDigest: 'digest-b' })
  return registry
}

function seeded(): { file: string; manager: RunManager; generations: GenerationService; ledger: EffectLedger; authority: AuthorityService; transitions: TransitionService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = makeRegistry()
  const generations = new GenerationService(manager, rc5(), registry)
  const ledger = new EffectLedger(manager)
  const authority = new AuthorityService(manager)
  const transitions = new TransitionService(manager, rc5(), generations, ledger, registry, authority)
  return { file, manager, generations, ledger, authority, transitions }
}

function seedActive(world: ReturnType<typeof seeded>, generationId = 'g1'): void {
  const { manager, generations, authority } = world
  generations.prepare(run, 'agent-1', 'native-1', AgentGenerationId(generationId), routeA, {})
  generations.activate(run, AgentGenerationId(generationId))
  authority.issue(run, AgentGenerationId(generationId), {
    toolScope: ['fs.read', 'fs.write', 'shell.run'], writePaths: ['/workspace'], approvalRequired: ['shell.run'],
  })
  expect(statusOf(manager, generationId)).toBe('ACTIVE')
}

const spec = (overrides: Partial<TransitionRequestSpec> = {}): TransitionRequestSpec => ({
  transitionId: 'tr-1', agentId: 'agent-1', mode: 'MANUAL',
  fromGenerationId: AgentGenerationId('g1'),
  to: { generationId: AgentGenerationId('g2'), sessionId: 'native-2', route: routeB, requirements: noReqs },
  ...overrides,
})

describe('D04 authority continuity: tool scope, permissions and context survive a switch without expansion', () => {
  it('issues an immutable authority profile and restores it from the journal after restart', () => {
    const world = seeded()
    const { manager, authority, file } = world
    try {
      seedActive(world)
      expect(authority.authorityOf(AgentGenerationId('g1'))).toMatchObject({ toolScope: ['fs.read', 'fs.write', 'shell.run'], approvalRequired: ['shell.run'] })
      // Immutable: a second issuance for the same generation is rejected.
      expect(() => authority.issue(run, AgentGenerationId('g1'), { toolScope: ['fs.read'], writePaths: [], approvalRequired: [] }))
        .toThrow(/authority already issued/)
      // Journal-derived restore: a fresh process replays the same profile exactly.
      const before = authority.authorityOf(AgentGenerationId('g1'))
      manager.close()
      const reopened = openRunManager(file)
      try {
        const restored = new AuthorityService(reopened)
        expect(restored.authorityOf(AgentGenerationId('g1'))).toEqual(before)
      } finally { reopened.close() }
      void manager
    } finally { void manager }
  })

  it('denies tools outside the generation scope and unknown generations', () => {
    const world = seeded()
    const { manager, authority } = world
    try {
      seedActive(world)
      expect(() => authority.assertAuthorized(AgentGenerationId('g1'), 'fs.read')).not.toThrow()
      expect(() => authority.assertAuthorized(AgentGenerationId('g1'), 'net.fetch')).toThrow(/AUTHORITY_DENIED.*net\.fetch/)
      expect(() => authority.assertAuthorized(AgentGenerationId('ghost'), 'fs.read')).toThrow(/AUTHORITY_DENIED.*unknown generation/)
    } finally { manager.close() }
  })

  it('rejects a transition whose new authority expands the old one, before appending any event', () => {
    const world = seeded()
    const { manager, transitions } = world
    try {
      seedActive(world)
      const before = manager.getState()
      const result = transitions.request(run, spec({
        to: { generationId: AgentGenerationId('g2'), sessionId: 'native-2', route: routeB, requirements: noReqs,
          authority: { toolScope: ['fs.read', 'fs.write', 'shell.run', 'net.fetch'], writePaths: ['/workspace', '/etc'], approvalRequired: ['shell.run'] } },
      }))
      expect(result.outcome).toBe('REJECTED')
      if (result.outcome !== 'REJECTED') throw new Error('unreachable')
      expect(result.reason).toMatch(/authority expansion: \+net\.fetch, \+\/etc/)
      expect(manager.getState().revision).toBe(before.revision)
      expect(manager.listEvents(run)).toHaveLength(5) // seed x2 + prepare + activate + authority
    } finally { manager.close() }
  })

  it('rejects a transition that drops an approval requirement (approval demand shrinking is expansion)', () => {
    const world = seeded()
    const { manager, transitions } = world
    try {
      seedActive(world)
      const result = transitions.request(run, spec({
        to: { generationId: AgentGenerationId('g2'), sessionId: 'native-2', route: routeB, requirements: noReqs,
          authority: { toolScope: ['fs.read', 'fs.write', 'shell.run'], writePaths: ['/workspace'], approvalRequired: [] } },
      }))
      expect(result.outcome).toBe('REJECTED')
      if (result.outcome !== 'REJECTED') throw new Error('unreachable')
      expect(result.reason).toMatch(/approval requirement dropped: shell\.run/)
      expect(manager.listEvents(run)).toHaveLength(5)
    } finally { manager.close() }
  })

  it('commits a scope-preserving switch and issues the replacement authority before the atomic commit', () => {
    const world = seeded()
    const { manager, transitions, authority } = world
    try {
      seedActive(world)
      const result = transitions.request(run, spec({
        to: { generationId: AgentGenerationId('g2'), sessionId: 'native-2', route: routeB, requirements: noReqs,
          authority: { toolScope: ['fs.read', 'fs.write', 'shell.run'], writePaths: ['/workspace'], approvalRequired: ['shell.run'] } },
      }))
      expect(result.outcome).toBe('COMMITTED')
      expect(statusOf(manager, 'g1')).toBe('RETIRED')
      expect(statusOf(manager, 'g2')).toBe('ACTIVE')
      expect(authority.authorityOf(AgentGenerationId('g2'))).toMatchObject({ toolScope: ['fs.read', 'fs.write', 'shell.run'] })
      // AUTHORITY_ISSUED must appear BEFORE the switch commit in the journal.
      const types = manager.listEvents(run).map(e => e.type)
      expect(types.indexOf('AUTHORITY_ISSUED')).toBeLessThan(types.indexOf('GENERATION_SWITCH_COMMITTED'))
      expect(types.indexOf('AUTHORITY_ISSUED')).toBeGreaterThan(types.indexOf('GENERATION_PREPARED'))
      // The new generation's authority is already enforced for its first effect.
      expect(() => authority.assertAuthorized(AgentGenerationId('g2'), 'shell.run')).not.toThrow()
    } finally { manager.close() }
  })

  it('resumeContext reports the exact pre-switch authority and unsettled effects for recovery', () => {
    const world = seeded()
    const { manager, authority, ledger, generations } = world
    try {
      seedActive(world)
      const context = authority.resumeContext(run, 'agent-1')
      expect(context).toMatchObject({ runId: run, runStatus: 'RUNNING', generationId: 'g1', epoch: 1 })
      expect(context.authority).toMatchObject({ toolScope: ['fs.read', 'fs.write', 'shell.run'] })
      expect(context.unsettledEffects).toEqual([])
      ledger.recordIntent(run, { effectId: 'fx-1', generationId: AgentGenerationId('g1'), toolCallId: 'call-1',
        effectClass: 'IDEMPOTENT', fingerprint: 'fp', idempotencyKey: 'k1' }, rev(manager))
      expect(authority.resumeContext(run, 'agent-1').unsettledEffects).toEqual(['fx-1:INTENT'])
      void generations
    } finally { manager.close() }
  })
})
