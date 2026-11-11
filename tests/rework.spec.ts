import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { AgentManager } from '../src/agents/index.js'
import { IndependentVerifier, sha256 } from '../src/verification/index.js'
import { BudgetService, type PriceTable } from '../src/budget/index.js'
import { ReworkCoordinator } from '../src/rework/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-i02-')); dirs.push(dir); return join(dir, 'fusion.db') }
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
const prices: PriceTable = { priceOf: () => ({ inputMicrosPerToken: 10, outputMicrosPerToken: 20, priceVersion: 'v1' }) }

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
const rev = (manager: RunManager) => {
  const current = manager.getRun(run)
  if (!current) throw new Error('test bug: run missing')
  return current.revision
}

function seeded(): { file: string; manager: RunManager; agents: AgentManager; verifier: IndependentVerifier; rework: ReworkCoordinator; budgets: BudgetService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-lead', 'native-lead', AgentGenerationId('g-lead'), route, {})
  generations.activate(run, AgentGenerationId('g-lead'))
  generations.prepare(run, 'agent-worker', 'native-worker', AgentGenerationId('g-worker'), route, {})
  generations.activate(run, AgentGenerationId('g-worker'))
  const agents = new AgentManager(manager, rc5())
  agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-worker', brief: { objective: 'build', constraints: [], contextRefs: [] }, writeScope: [] })
  const verifier = new IndependentVerifier(manager, rc5())
  const budgets = new BudgetService(manager, prices)
  return { file, manager, agents, verifier, budgets, rework: new ReworkCoordinator(manager, agents, verifier, budgets) }
}

const must = (agents: AgentManager, id: string) => {
  const record = agents.get(id)
  if (!record) throw new Error(`test bug: assignment ${id} missing`)
  return record
}

describe('I02 rework triage, graded rework and lead arbitration', () => {
  it('maps report severity to rework tiers and orders graded rework with additive constraints', () => {
    const world = seeded()
    const { manager, agents, rework } = world
    try {
      agents.report(run, { reportId: 'r-low', assignmentId: 'a-1', generationId: 'g-worker', summary: 'minor issue', status: 'FAILED', artifacts: [] })
      const minor = rework.triage(run, 'a-1', { verdict: 'RISK', severity: 'LOW', findings: ['style drift'] })
      expect(minor).toMatchObject({ tier: 'MINOR', ordered: true })
      expect(must(agents, 'a-1').briefRevision).toBe(2)
      expect(must(agents, 'a-1').constraints).toContain('rework:MINOR style drift')

      const major = rework.triage(run, 'a-1', { verdict: 'RISK', severity: 'MEDIUM', findings: ['wrong output shape'] })
      expect(major).toMatchObject({ tier: 'MAJOR', ordered: true })
      expect(must(agents, 'a-1').briefRevision).toBe(3)

      const blocker = rework.triage(run, 'a-1', { verdict: 'RISK', severity: 'HIGH', findings: ['data loss'] })
      expect(blocker).toMatchObject({ tier: 'BLOCKER', ordered: false, requiresArbitration: true })
      expect(must(agents, 'a-1').briefRevision).toBe(3)
      void manager
    } finally { manager.close() }
  })

  it('routes blockers through lead arbitration: rework, accept and escalate rulings', () => {
    const world = seeded()
    const { manager, agents, rework } = world
    try {
      rework.arbitrate(run, 'a-1', AgentGenerationId('g-lead'), 'REWORK', 'must fix data loss before merge')
      expect(must(agents, 'a-1').arbitration).toMatchObject({ ruling: 'REWORK', by: 'g-lead' })
      const ordered = rework.orderRework(run, 'a-1', 'BLOCKER', ['preserve user data'])
      expect(ordered.briefRevision).toBe(2)

      rework.arbitrate(run, 'a-1', AgentGenerationId('g-lead'), 'ACCEPT', 'accepted as documented waiver')
      expect(must(agents, 'a-1').arbitration?.ruling).toBe('ACCEPT')
      rework.arbitrate(run, 'a-1', AgentGenerationId('g-lead'), 'ESCALATE', 'beyond lead authority')
      expect(must(agents, 'a-1').arbitration?.ruling).toBe('ESCALATE')
      void rev
    } finally { manager.close() }
  })

  it('blocks rework when the estimated cost exceeds the remaining budget', () => {
    const world = seeded()
    const { manager, budgets, rework } = world
    try {
      budgets.reserve(run, 'budget-1', 1000)
      expect(() => rework.orderRework(run, 'a-1', 'MAJOR', ['fix'], { budgetId: 'budget-1', estimatedCostMicros: 2000 }))
        .toThrow(/REWORK_BUDGET_EXCEEDED/)
      const ok = rework.orderRework(run, 'a-1', 'MAJOR', ['fix'], { budgetId: 'budget-1', estimatedCostMicros: 800 })
      expect(ok.briefRevision).toBe(2)
      void manager
    } finally { manager.close() }
  })

  it('detects regressions of previously verified requirements and never accepts them', () => {
    const world = seeded()
    const { manager, verifier, rework } = world
    try {
      verifier.recordEvidence(run, { evidenceId: 'ev-a', requirementId: 'req-a', level: 'E2', source: 'UNIT_TEST',
        command: 'test a', exitCode: 0, artifactDigest: sha256('good'), producerGenerationId: 'g-worker' })
      verifier.verify(run, 'req-a', 'ev-a', AgentGenerationId('g-lead'), { artifactContent: 'good' })
      rework.assertNoRegression(run, ['req-a'])
      // The requirement regresses after a tampered re-verification.
      verifier.recordEvidence(run, { evidenceId: 'ev-a2', requirementId: 'req-a', level: 'E2', source: 'UNIT_TEST',
        command: 'test a', exitCode: 0, artifactDigest: sha256('broken'), producerGenerationId: 'g-worker' })
      verifier.verify(run, 'req-a', 'ev-a2', AgentGenerationId('g-lead'), { artifactContent: 'broken-but-different' })
      expect(() => rework.assertNoRegression(run, ['req-a'])).toThrow(/REGRESSION_DETECTED/)
      void manager
    } finally { manager.close() }
  })

  it('restores arbitration rulings and rework revisions after restart', () => {
    const world = seeded()
    const { manager, agents, rework, file } = world
    try {
      rework.arbitrate(run, 'a-1', AgentGenerationId('g-lead'), 'REWORK', 'fix it')
      rework.orderRework(run, 'a-1', 'MINOR', ['tighten'])
      manager.close()
      const reopened = openRunManager(file)
      try {
        const agentsRestored = new AgentManager(reopened, rc5())
        expect(must(agentsRestored, 'a-1').arbitration).toMatchObject({ ruling: 'REWORK' })
        expect(must(agentsRestored, 'a-1').briefRevision).toBe(2)
        expect(must(agentsRestored, 'a-1').constraints).toContain('rework:MINOR tighten')
        void rework
      } finally { reopened.close() }
    } finally { void agents }
  })
})
