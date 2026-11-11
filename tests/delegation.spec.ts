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
import { RoleManager, ROLE_PRESETS } from '../src/agents/roles.js'
import { AuthorityService } from '../src/authority/index.js'
import { DelegationAdvisor } from '../src/delegation/index.js'

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
const capability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' }

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
const rev = (manager: RunManager) => {
  const current = manager.getRun(run)
  if (!current) throw new Error('test bug: run missing')
  return current.revision
}

function seeded(): { file: string; manager: RunManager; agents: AgentManager; roles: RoleManager; advisor: DelegationAdvisor; generations: GenerationService; authority: AuthorityService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DELEGATE', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-lead', 'native-lead', AgentGenerationId('g-lead'), route, {})
  generations.activate(run, AgentGenerationId('g-lead'))
  generations.prepare(run, 'agent-worker', 'native-worker', AgentGenerationId('g-worker'), route, {})
  generations.activate(run, AgentGenerationId('g-worker'))
  const agents = new AgentManager(manager, rc5())
  const authority = new AuthorityService(manager)
  const roles = new RoleManager(manager, agents, authority, rc5())
  const advisor = new DelegationAdvisor(manager, agents, roles)
  return { file, manager, agents, roles, advisor, generations, authority }
}

describe('G03 value-of-delegation and adaptive brief feedback', () => {
  it('chooses Direct when delegation has no positive net benefit, Delegate when speedup makes it worthwhile', () => {
    const world = seeded()
    const { advisor } = world
    try {
      // 10000 direct vs 8000 worker + 1000 coordination + 1000 review = 10000 → net 0 → Direct.
      const even = advisor.advise({ directCostMicros: 10_000, delegateWorkerCostMicros: 8_000, coordinationCostMicros: 1_000, reviewCostMicros: 1_000 })
      expect(even.mode).toBe('DIRECT')
      // Parallel speedup halves the effective worker cost → net 4000 > 0 → Delegate.
      const sped = advisor.advise({ directCostMicros: 10_000, delegateWorkerCostMicros: 8_000, coordinationCostMicros: 1_000, reviewCostMicros: 1_000, parallelSpeedup: 2 })
      expect(sped.mode).toBe('DELEGATE')
      expect(sped.netBenefitMicros).toBe(4_000)
    } finally { world.manager.close() }
  })

  it('falls back to Direct after repeated delegation failures and when the budget cannot fund it', () => {
    const world = seeded()
    const { advisor } = world
    try {
      const profitable = { directCostMicros: 10_000, delegateWorkerCostMicros: 4_000, coordinationCostMicros: 500, reviewCostMicros: 500 }
      expect(advisor.advise({ ...profitable, recentFailures: 2, failureThreshold: 3 }).mode).toBe('DELEGATE')
      const failed = advisor.advise({ ...profitable, recentFailures: 3, failureThreshold: 3 })
      expect(failed.mode).toBe('DIRECT')
      expect(failed.reasons.some(reason => reason.includes('failures'))).toBe(true)
      const underfunded = advisor.advise({ ...profitable, budgetRemainingMicros: 4_999 })
      expect(underfunded.mode).toBe('DIRECT')
      expect(underfunded.reasons.some(reason => reason.includes('budget'))).toBe(true)
    } finally { world.manager.close() }
  })

  it('journals delegation outcomes into per-mode stats and restores them after restart', () => {
    const world = seeded()
    const { manager, advisor, file, agents } = world
    try {
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-worker',
        brief: { objective: 'o', constraints: [], contextRefs: [] }, writeScope: [] })
      advisor.recordOutcome(run, 'a-1', 'DELEGATE', 6_000, 'COMPLETED')
      advisor.recordOutcome(run, 'a-1', 'DELEGATE', 4_000, 'FAILED')
      advisor.recordOutcome(run, 'a-1', 'DIRECT', 2_000, 'COMPLETED')
      expect(advisor.stats()).toMatchObject({
        DELEGATE: { attempts: 2, failures: 1, spentMicros: 10_000 },
        DIRECT: { attempts: 1, failures: 0, spentMicros: 2_000 },
      })
      manager.close()
      const reopened = openRunManager(file)
      try {
        expect(new DelegationAdvisor(reopened, new AgentManager(reopened, rc5())).stats())
          .toMatchObject({ DELEGATE: { attempts: 2, failures: 1, spentMicros: 10_000 } })
      } finally { reopened.close() }
    } finally { void agents }
  })

  it('feeds shadow-review risk findings back into the brief without dropping any constraint', () => {
    const world = seeded()
    const { manager, advisor, agents } = world
    try {
      agents.assign(run, { assignmentId: 'a-coder', role: 'WORKER', workerAgentId: 'agent-worker',
        brief: { objective: 'implement the feature', constraints: ['no new deps', 'keep tests green'], contextRefs: [] }, writeScope: ['src/'] })
      const outcome = advisor.applyFeedback(run, 'a-coder', { verdict: 'RISK', severity: 'HIGH', findings: ['shell.run unbounded'] })
      expect(outcome.briefRevision).toBe(2)
      const record = agents.get('a-coder')
      if (!record) throw new Error('test bug: assignment missing')
      expect([...record.constraints]).toEqual(expect.arrayContaining(['no new deps', 'keep tests green', 'risk:HIGH shell.run unbounded']))
      expect(record.constraints.length).toBe(3)
      void manager
    } finally { manager.close() }
    void ROLE_PRESETS
  })
})
