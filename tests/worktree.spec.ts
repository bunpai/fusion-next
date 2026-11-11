import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2, openFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { WorktreeManager, mergeChanges } from '../src/worktree/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-h02-')); dirs.push(dir); return join(dir, 'fusion.db') }
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

function seeded(): { file: string; manager: RunManager; worktrees: WorktreeManager } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'PARALLEL', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-w', 'native-w', AgentGenerationId('g-w'), route, {})
  generations.activate(run, AgentGenerationId('g-w'))
  return { file, manager, worktrees: new WorktreeManager(manager, rc5()) }
}

describe('H02 worktree manager: acquisition, merge outcomes, rollback and cleanup', () => {
  it('acquires worktrees, rejects duplicate paths and restores records after restart with a projection row', () => {
    const world = seeded()
    const { manager, worktrees, file } = world
    try {
      worktrees.acquire(run, { worktreeId: 'wt-1', generationId: 'g-w', path: '/repo/.worktrees/wt-1', branch: 'fusion/wt-1', baseCommit: 'abc123' })
      expect(() => worktrees.acquire(run, { worktreeId: 'wt-2', generationId: 'g-w', path: '/repo/.worktrees/wt-1', branch: 'fusion/wt-2', baseCommit: 'abc123' }))
        .toThrow(/worktree path already acquired/)
      manager.close()
      const reopened = openRunManager(file)
      try {
        const restored = new WorktreeManager(reopened, rc5())
        const record = restored.get('wt-1')
        expect(record.state).toBe('ACTIVE')
        expect(record.branch).toBe('fusion/wt-1')
        const db = openFusionV2(file)
        const row = db.prepare('SELECT path, base_commit, state FROM fusion_worktrees WHERE id = ?').get('wt-1') as { path: string; base_commit: string; state: string }
        expect(row).toMatchObject({ path: '/repo/.worktrees/wt-1', base_commit: 'abc123', state: 'ACTIVE' })
        db.close()
      } finally { reopened.close() }
    } finally { void manager }
  })

  it('computes deterministic merge outcomes: disjoint clean, identical clean, differing conflict', () => {
    expect(mergeChanges({ 'a.ts': '1', 'b.ts': '2' }, { 'a.ts': '1x' }, { 'b.ts': '2y' }))
      .toMatchObject({ status: 'CLEAN' })
    expect(mergeChanges({ 'a.ts': '1' }, { 'a.ts': 'same' }, { 'a.ts': 'same' }))
      .toMatchObject({ status: 'CLEAN' })
    const conflict = mergeChanges({ 'a.ts': '1' }, { 'a.ts': 'ours' }, { 'a.ts': 'theirs' })
    if (conflict.status !== 'CONFLICT') throw new Error('test bug: expected conflict')
    expect(conflict.conflicts).toEqual(['a.ts'])
  })

  it('merges an active worktree, rolls back on conflict and enforces state transitions', () => {
    const world = seeded()
    const { manager, worktrees } = world
    try {
      worktrees.acquire(run, { worktreeId: 'wt-1', generationId: 'g-w', path: '/repo/.worktrees/wt-1', branch: 'fusion/wt-1', baseCommit: 'abc123' })
      worktrees.merge(run, 'wt-1', { mergeCommit: 'def456', mergeDigest: 'digest-merge' })
      expect(worktrees.get('wt-1').state).toBe('MERGED')
      expect(() => worktrees.rollback(run, 'wt-1', 'no longer active')).toThrow(/committed worktree cannot roll back/)
      worktrees.release(run, 'wt-1')
      expect(worktrees.get('wt-1').state).toBe('RELEASED')
      expect(() => worktrees.release(run, 'wt-1')).toThrow(/already released/)

      worktrees.acquire(run, { worktreeId: 'wt-2', generationId: 'g-w', path: '/repo/.worktrees/wt-2', branch: 'fusion/wt-2', baseCommit: 'abc123' })
      worktrees.rollback(run, 'wt-2', 'merge conflict in a.ts')
      const rolled = worktrees.get('wt-2')
      expect(rolled.state).toBe('ROLLED_BACK')
      expect(rolled.rollbackRef).toBe('merge conflict in a.ts')
      worktrees.release(run, 'wt-2')
      expect(worktrees.get('wt-2').state).toBe('RELEASED')
      void rev
    } finally { manager.close() }
  })

  it('denies worktree operations on rc2/unknown capability reports', () => {
    const world = seeded()
    const { manager } = world
    try {
      const denied = new WorktreeManager(manager, probeHostCapabilities({ sdkVersion: '0.2.1-rc.2', observed: observedAllTrue }))
      expect(() => denied.acquire(run, { worktreeId: 'wt-x', generationId: 'g-w', path: '/repo/.worktrees/wt-x', branch: 'fusion/wt-x', baseCommit: 'abc123' }))
        .toThrow(/HOST_CAPABILITY_DENIED/)
      expect(manager.getState().worktrees['wt-x']).toBeUndefined()
    } finally { manager.close() }
  })
})
