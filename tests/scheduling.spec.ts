import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { AgentManager } from '../src/agents/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { Scheduler, ProviderLimiter } from '../src/scheduling/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-h01-')); dirs.push(dir); return join(dir, 'fusion.db') }
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
const capability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' }

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
const rev = (manager: RunManager) => {
  const current = manager.getRun(run)
  if (!current) throw new Error('test bug: run missing')
  return current.revision
}

function seeded(): { file: string; manager: RunManager; agents: AgentManager; scheduler: Scheduler; generations: GenerationService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'PARALLEL', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-lead', 'native-lead', AgentGenerationId('g-lead'), route, {})
  generations.activate(run, AgentGenerationId('g-lead'))
  generations.prepare(run, 'agent-w1', 'native-w1', AgentGenerationId('g-w1'), route, {})
  generations.activate(run, AgentGenerationId('g-w1'))
  generations.prepare(run, 'agent-w2', 'native-w2', AgentGenerationId('g-w2'), route, {})
  generations.activate(run, AgentGenerationId('g-w2'))
  const agents = new AgentManager(manager, rc5())
  return { file, manager, agents, scheduler: new Scheduler(manager, agents), generations }
}

describe('H01 assignment DAG, file ownership, concurrency scheduling and provider limits', () => {
  it('declares dependencies, rejects cycles and self-dependence, and computes deterministic readiness', () => {
    const world = seeded()
    const { manager, agents, scheduler } = world
    try {
      agents.assign(run, { assignmentId: 'a-docs', role: 'WORKER', workerAgentId: 'agent-w1', brief: { objective: 'docs', constraints: [], contextRefs: [] }, writeScope: [] })
      agents.assign(run, { assignmentId: 'a-code', role: 'WORKER', workerAgentId: 'agent-w2', brief: { objective: 'code', constraints: [], contextRefs: [] }, writeScope: [] })
      scheduler.declareDependency(run, 'a-code', 'a-docs')
      expect(() => scheduler.declareDependency(run, 'a-docs', 'a-code')).toThrow(/assignment dependency cycle/)
      expect(() => scheduler.declareDependency(run, 'a-docs', 'a-docs')).toThrow(/depend on itself/)
      expect(scheduler.readyAssignments(run)).toEqual(['a-docs'])
      agents.report(run, { reportId: 'r-docs', assignmentId: 'a-docs', generationId: 'g-w1', summary: 'done', status: 'COMPLETED', artifacts: [] })
      agents.complete(run, 'a-docs', 'r-docs')
      expect(scheduler.readyAssignments(run)).toEqual(['a-code'])
      void manager
    } finally { manager.close() }
  })

  it('enforces file ownership: a second claim on a live path conflicts until the owner finalizes', () => {
    const world = seeded()
    const { agents, scheduler } = world
    try {
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-w1', brief: { objective: 'o1', constraints: [], contextRefs: [] }, writeScope: ['src/shared.ts'] })
      agents.assign(run, { assignmentId: 'a-2', role: 'WORKER', workerAgentId: 'agent-w2', brief: { objective: 'o2', constraints: [], contextRefs: [] }, writeScope: ['src/shared.ts'] })
      scheduler.claimFiles(run, 'a-1', ['src/shared.ts'])
      expect(() => scheduler.claimFiles(run, 'a-2', ['src/shared.ts'])).toThrow(/file path .* already claimed by assignment a-1/)
      // Non-overlapping claims coexist.
      scheduler.claimFiles(run, 'a-2', ['src/other.ts'])
      agents.report(run, { reportId: 'r-1', assignmentId: 'a-1', generationId: 'g-w1', summary: 'done', status: 'COMPLETED', artifacts: [] })
      agents.complete(run, 'a-1', 'r-1')
      scheduler.claimFiles(run, 'a-2', ['src/shared.ts'])
      expect(scheduler.ownerOf(run, 'src/shared.ts')).toBe('a-2')
    } finally { world.manager.close() }
  })

  it('restores dependencies and file claims from the journal after restart', () => {
    const world = seeded()
    const { manager, agents, scheduler, file } = world
    try {
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-w1', brief: { objective: 'o1', constraints: [], contextRefs: [] }, writeScope: [] })
      agents.assign(run, { assignmentId: 'a-2', role: 'WORKER', workerAgentId: 'agent-w2', brief: { objective: 'o2', constraints: [], contextRefs: [] }, writeScope: [] })
      scheduler.declareDependency(run, 'a-2', 'a-1')
      scheduler.claimFiles(run, 'a-1', ['src/only.ts'])
      manager.close()
      const reopened = openRunManager(file)
      try {
        const restored = new Scheduler(reopened, new AgentManager(reopened, rc5()))
        expect(restored.readyAssignments(run)).toEqual(['a-1'])
        expect(restored.ownerOf(run, 'src/only.ts')).toBe('a-1')
      } finally { reopened.close() }
    } finally { void manager }
  })

  it('limits provider concurrency per provider and in total, releasing slots on completion', () => {
    const limiter = new ProviderLimiter({ maxConcurrentPerProvider: 1, maxConcurrentTotal: 2 })
    expect(limiter.acquire('alpha')).toBe(true)
    expect(limiter.acquire('alpha')).toBe(false)
    expect(limiter.acquire('beta')).toBe(true)
    expect(limiter.acquire('gamma')).toBe(false)
    limiter.release('alpha')
    expect(limiter.acquire('gamma')).toBe(true)
    expect(limiter.inFlight()).toMatchObject({ alpha: 0, beta: 1, gamma: 1, total: 2 })
  })
})
