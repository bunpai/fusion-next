import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { AgentManager } from '../src/agents/index.js'
import { AuthorityService } from '../src/authority/index.js'
import { RoleManager } from '../src/agents/roles.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-e02-')); dirs.push(dir); return join(dir, 'fusion.db') }
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

const capability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' }

function seeded(): {
  file: string; manager: RunManager; agents: AgentManager; generations: GenerationService
  authority: AuthorityService; roles: RoleManager
} {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DELEGATE', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  const authority = new AuthorityService(manager)
  const agents = new AgentManager(manager, rc5())
  const roles = new RoleManager(manager, agents, authority, rc5())
  for (const [agentId, genId, native] of [['agent-explorer', 'g-explorer', 'native-explorer'], ['agent-coder', 'g-coder', 'native-coder'], ['agent-shadow', 'g-shadow', 'native-shadow']] as const) {
    generations.prepare(run, agentId, native, AgentGenerationId(genId), route, {})
    generations.activate(run, AgentGenerationId(genId))
  }
  return { file, manager, agents, generations, authority, roles }
}

describe('E02 roles: Explorer/Coder/Reviewer + Shadow Reviewer with read-only isolation and risk escalation', () => {
  it('staffs an Explorer whose authority is read-only: writes and shell are denied, reads are allowed', () => {
    const world = seeded()
    const { manager, roles } = world
    try {
      const staffed = roles.staffRole(run, { role: 'EXPLORER', agentId: 'agent-explorer', generationId: 'g-explorer',
        assignmentId: 'a-explore', brief: { objective: 'map the repo', constraints: [], contextRefs: [] } })
      expect(staffed.status).toBe('OPEN')
      expect(() => world.authority.assertAuthorized('g-explorer', 'fs.read')).not.toThrow()
      expect(() => world.authority.assertAuthorized('g-explorer', 'fs.write')).toThrow(/AUTHORITY_DENIED/)
      expect(() => world.authority.assertAuthorized('g-explorer', 'shell.run')).toThrow(/AUTHORITY_DENIED/)
      void manager
    } finally { manager.close() }
  })

  it('staffs a Coder with a write fence: tools inside scope pass, paths outside writePaths are denied', () => {
    const world = seeded()
    const { roles, authority } = world
    try {
      roles.staffRole(run, { role: 'CODER', agentId: 'agent-coder', generationId: 'g-coder',
        assignmentId: 'a-code', brief: { objective: 'fix it', constraints: [], contextRefs: [] },
        writePaths: ['src/bug.ts'] })
      expect(() => authority.assertAuthorized('g-coder', 'fs.write')).not.toThrow()
      expect(() => roles.assertWithinWriteScope('g-coder', 'src/bug.ts')).not.toThrow()
      expect(() => roles.assertWithinWriteScope('g-coder', 'src/other.ts')).toThrow(/WRITE_PATH_DENIED/)
      expect(() => roles.assertWithinWriteScope('g-explorer-does-not-exist', 'src/bug.ts')).toThrow(/AUTHORITY_DENIED|unknown generation/i)
    } finally { world.manager.close() }
  })

  it('refuses role staffing that would escalate beyond the role preset (no privilege expansion)', () => {
    const world = seeded()
    const { manager, roles } = world
    try {
      expect(() => roles.staffRole(run, { role: 'EXPLORER', agentId: 'agent-explorer', generationId: 'g-explorer',
        assignmentId: 'a-x', brief: { objective: 'o', constraints: [], contextRefs: [] },
        extraTools: ['shell.run'] })).toThrow(/ROLE_SCOPE_VIOLATION/)
      expect(() => roles.staffRole(run, { role: 'SHADOW_REVIEWER', agentId: 'agent-shadow', generationId: 'g-shadow',
        assignmentId: 'a-s', brief: { objective: 'o', constraints: [], contextRefs: [] },
        writePaths: ['src/'] })).toThrow(/ROLE_SCOPE_VIOLATION/)
      void manager
    } finally { manager.close() }
  })

  it('keeps authority stable across a generation switch for the same role (no expansion on switch)', () => {
    const world = seeded()
    const { manager, roles, generations, authority } = world
    try {
      roles.staffRole(run, { role: 'CODER', agentId: 'agent-coder', generationId: 'g-coder',
        assignmentId: 'a-code', brief: { objective: 'fix it', constraints: [], contextRefs: [] },
        writePaths: ['src/bug.ts'] })
      generations.switchGeneration(run, 'agent-coder', AgentGenerationId('g-coder'),
        { generationId: AgentGenerationId('g-coder-2'), sessionId: 'native-coder-2', route, requirements: {} })
      roles.staffRole(run, { role: 'CODER', agentId: 'agent-coder', generationId: 'g-coder-2',
        assignmentId: 'a-code-2', brief: { objective: 'fix it more', constraints: [], contextRefs: [] },
        writePaths: ['src/bug.ts'] })
      // Same preset re-issued for the new generation: identical scope, not an expansion.
      expect(() => authority.assertAuthorized('g-coder-2', 'fs.write')).not.toThrow()
      // An attempt to widen the preset for the same role is rejected before any event.
      expect(() => roles.staffRole(run, { role: 'CODER', agentId: 'agent-coder', generationId: 'g-coder-2',
        assignmentId: 'a-code-3', brief: { objective: 'o', constraints: [], contextRefs: [] },
        writePaths: ['src/bug.ts', 'src/wider.ts'] })).toThrow(/ROLE_SCOPE_VIOLATION|authority expansion/i)
    } finally { manager.close() }
  })

  it('Shadow Reviewer stays read-only and its RISK verdict escalates into an adaptive brief revision', () => {
    const world = seeded()
    const { manager, roles } = world
    try {
      roles.staffRole(run, { role: 'CODER', agentId: 'agent-coder', generationId: 'g-coder',
        assignmentId: 'a-code', brief: { objective: 'refactor module', constraints: ['keep tests green'], contextRefs: [] },
        writePaths: ['src/mod.ts'] })
      roles.staffRole(run, { role: 'SHADOW_REVIEWER', agentId: 'agent-shadow', generationId: 'g-shadow',
        assignmentId: 'a-shadow', brief: { objective: 'observe coder a-code', constraints: [], contextRefs: [] } })
      // Shadow cannot write even though it observes code.
      expect(() => world.authority.assertAuthorized('g-shadow', 'fs.write')).toThrow(/AUTHORITY_DENIED/)
      const escalation = roles.shadowReview(run, { reportId: 'r-shadow-1', generationId: 'g-shadow',
        coderAssignmentId: 'a-code', verdict: 'RISK', severity: 'HIGH', findings: ['unbounded retry on 429'] })
      expect(escalation.escalated).toBe(true)
      const coder = roles.get('a-code')
      if (!coder) throw new Error('test bug: coder assignment missing')
      expect(coder.briefRevision).toBe(2)
      expect(coder.constraints).toContain('risk:HIGH unbounded retry on 429')
      // LOW severity observation records evidence without touching the coder brief.
      const quiet = roles.shadowReview(run, { reportId: 'r-shadow-2', generationId: 'g-shadow',
        coderAssignmentId: 'a-code', verdict: 'CLEAN', severity: 'LOW', findings: [] })
      expect(quiet.escalated).toBe(false)
      expect(roles.get('a-code')?.briefRevision).toBe(2)
    } finally { manager.close() }
  })

  it('adaptive brief: a NEEDS_INPUT report refines the brief with a higher revision and merged constraints', () => {
    const world = seeded()
    const { manager, roles } = world
    try {
      roles.staffRole(run, { role: 'CODER', agentId: 'agent-coder', generationId: 'g-coder',
        assignmentId: 'a-code', brief: { objective: 'fix bug', constraints: ['keep tests green'], contextRefs: [] },
        writePaths: ['src/bug.ts'] })
      world.agents.report(run, { reportId: 'r-1', assignmentId: 'a-code', generationId: 'g-coder',
        summary: 'need the failing stack trace', status: 'NEEDS_INPUT', artifacts: [] })
      const adapted = roles.adaptBrief(run, 'a-code', { objective: 'fix bug with stack trace',
        extraConstraints: ['attach failing stack trace'] })
      expect(adapted.briefRevision).toBe(2)
      expect(adapted.constraints).toEqual(['attach failing stack trace', 'keep tests green'])
      void manager
    } finally { manager.close() }
  })
})
