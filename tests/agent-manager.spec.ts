import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { AgentManager, type ReportSpec } from '../src/agents/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-e01-')); dirs.push(dir); return join(dir, 'fusion.db') }
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
const statusOf = (manager: RunManager, id: string) => manager.getState().generations[id]?.status

const capability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' }

function seeded(): { file: string; manager: RunManager; agents: AgentManager; generations: GenerationService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DELEGATE', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  const agents = new AgentManager(manager, rc5())
  return { file, manager, agents, generations }
}

/** Seed the lead (g-lead, current) plus one worker agent with a prepared+active generation. */
function seedWorkers(world: ReturnType<typeof seeded>): { workerGeneration: string } {
  const { manager, generations } = world
  generations.prepare(run, 'agent-lead', 'native-lead', AgentGenerationId('g-lead'), route, {})
  generations.activate(run, AgentGenerationId('g-lead'))
  generations.prepare(run, 'agent-worker', 'native-worker', AgentGenerationId('g-worker'), route, {})
  generations.activate(run, AgentGenerationId('g-worker'))
  expect(statusOf(manager, 'g-worker')).toBe('ACTIVE')
  return { workerGeneration: 'g-worker' }
}

describe('E01 agent manager: Direct/Delegate/Takeover with bidirectional briefs and fenced reports', () => {
  it('creates a DIRECT self-assignment, revises the brief monotonically, and refuses a worker on DIRECT', () => {
    const world = seeded()
    const { manager, agents } = world
    try {
      seedWorkers(world)
      const assigned = agents.assign(run, { assignmentId: 'a-1', role: 'LEAD', brief: { objective: 'ship the fix', constraints: ['no new deps'], contextRefs: ['ctx:1'] }, writeScope: ['src/'] })
      expect(assigned.status).toBe('OPEN')
      expect(agents.get('a-1')).toMatchObject({ role: 'LEAD', briefRevision: 1, objective: 'ship the fix' })
      agents.reviseBrief(run, 'a-1', 2, { objective: 'ship the fix faster', constraints: [], contextRefs: [] })
      expect(agents.get('a-1')?.briefRevision).toBe(2)
      // Same eventId (revision 2) re-issued with different contents is a fail-closed conflict.
      expect(() => agents.reviseBrief(run, 'a-1', 2, { objective: 'x', constraints: [], contextRefs: [] }))
        .toThrow(/event id reused with different contents/)
      expect(() => agents.assign(run, { assignmentId: 'a-2', role: 'LEAD', workerAgentId: 'agent-worker',
        brief: { objective: 'o', constraints: [], contextRefs: [] }, writeScope: [] }))
        .toThrow(/direct assignment must not carry a worker/)
      void manager
    } finally { manager.close() }
  })

  it('delegates to a worker, and a report from the worker current generation completes the assignment', () => {
    const world = seeded()
    const { manager, agents } = world
    try {
      seedWorkers(world)
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-worker',
        brief: { objective: 'fix the bug', constraints: [], contextRefs: [] }, writeScope: ['src/bug.ts'] })
      const report: ReportSpec = { reportId: 'r-1', assignmentId: 'a-1', generationId: 'g-worker',
        summary: 'fixed', status: 'COMPLETED', artifacts: ['src/bug.ts'] }
      agents.report(run, report)
      agents.complete(run, 'a-1', 'r-1')
      expect(agents.get('a-1')).toMatchObject({ status: 'COMPLETED', lastReportId: 'r-1' })
      // The report is journaled for the Lead (bidirectional brief/report channel).
      expect(manager.getState().reports['r-1']).toMatchObject({ assignmentId: 'a-1', status: 'COMPLETED' })
    } finally { manager.close() }
  })

  it('fences a report from a generation that is no longer current for the worker', () => {
    const world = seeded()
    const { manager, agents, generations, file } = world
    try {
      seedWorkers(world)
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-worker',
        brief: { objective: 'fix the bug', constraints: [], contextRefs: [] }, writeScope: ['src/bug.ts'] })
      // Switch the worker to a fresh generation (atomic switch retires g-worker).
      generations.switchGeneration(run, 'agent-worker', AgentGenerationId('g-worker'),
        { generationId: AgentGenerationId('g-worker-2'), sessionId: 'native-worker-2', route, requirements: {} })
      const stale: ReportSpec = { reportId: 'r-stale', assignmentId: 'a-1', generationId: 'g-worker',
        summary: 'late result', status: 'COMPLETED', artifacts: [] }
      const before = manager.getState()
      expect(() => agents.report(run, stale)).toThrow(/stale agent report fenced/)
      expect(manager.getState()).toEqual(before)
      // The current generation can still report.
      agents.report(run, { ...stale, reportId: 'r-fresh', generationId: 'g-worker-2' })
      expect(manager.getState().reports['r-fresh']).toMatchObject({ status: 'COMPLETED' })
      void file
    } finally { manager.close() }
  })

  it('rejects a report for an unknown assignment or a foreign generation', () => {
    const world = seeded()
    const { manager, agents } = world
    try {
      seedWorkers(world)
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-worker',
        brief: { objective: 'o', constraints: [], contextRefs: [] }, writeScope: [] })
      expect(() => agents.report(run, { reportId: 'r-x', assignmentId: 'a-missing', generationId: 'g-worker', summary: 's', status: 'COMPLETED', artifacts: [] }))
        .toThrow(/assignment.*unknown|unknown assignment/i)
      expect(() => agents.report(run, { reportId: 'r-y', assignmentId: 'a-1', generationId: 'g-lead', summary: 's', status: 'COMPLETED', artifacts: [] }))
        .toThrow(/stale agent report fenced/)
    } finally { manager.close() }
  })

  it('takeover reassigns control to the taker and journals who took over and why', () => {
    const world = seeded()
    const { manager, agents } = world
    try {
      seedWorkers(world)
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-worker',
        brief: { objective: 'long task', constraints: [], contextRefs: [] }, writeScope: ['src/'] })
      agents.takeover(run, 'a-1', 'agent-lead', 'worker stalled on approvals')
      expect(agents.get('a-1')).toMatchObject({ status: 'TAKEN_OVER', takenBy: 'agent-lead' })
      // Q06: after takeover the assignment cannot be completed by the old worker's report.
      expect(() => agents.report(run, { reportId: 'r-old', assignmentId: 'a-1', generationId: 'g-worker', summary: 's', status: 'COMPLETED', artifacts: [] }))
        .toThrow(/taken over|stale agent report fenced/i)
    } finally { manager.close() }
  })

  it('persists assignments across restart and enforces worker membership', () => {
    const world = seeded()
    const { manager, agents, file } = world
    try {
      seedWorkers(world)
      agents.assign(run, { assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-worker',
        brief: { objective: 'o', constraints: [], contextRefs: [] }, writeScope: ['src/'] })
      manager.close()
      const reopened = openRunManager(file)
      try {
        const restored = new AgentManager(reopened, rc5())
        expect(restored.get('a-1')).toMatchObject({ assignmentId: 'a-1', role: 'WORKER', workerAgentId: 'agent-worker', status: 'OPEN' })
        expect(() => restored.assign(run, { assignmentId: 'a-2', role: 'WORKER', workerAgentId: 'agent-ghost',
          brief: { objective: 'o', constraints: [], contextRefs: [] }, writeScope: [] }))
          .toThrow(/assignment worker not in run/)
      } finally { reopened.close() }
      void agents
    } finally { void manager }
  })
})
