import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { TaskId, WorkOrder } from '../src/contracts.js'
import { FusionRunId } from '../src/lifecycle/index.js'
import type { RunManager } from '../src/run-manager/index.js'
import { openRunManager } from '../src/run-manager/index.js'
import { migrateFusionV2 } from '../src/persistence/index.js'
import type { SqliteFusionStore } from '../src/task/sqlite-store.js'
import type { ResolvedProfile } from '../src/profile/resolve.js'
import { V2Shadow } from '../src/host/v2-shadow.js'
import type { RunEventInput } from '../src/run-manager/index.js'

const dirs: string[] = []
const path = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-shadow-'))
  dirs.push(dir)
  return join(dir, name)
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

const event = (payload: object, eventId: string): RunEventInput =>
  ({ schemaVersion: 1, eventId, ...payload }) as RunEventInput

const RUN = FusionRunId('fusion-run-session-1')

const seeded = (manager: RunManager) => {
  manager.append(event({ type: 'RUN_CREATED', runId: RUN, hostSessionId: 'session-1',
    taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'e-1'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: RUN, hostSessionId: 'session-1' }, 'e-2'), 1)
}

const storeStub = (parent = 'session-1') => ({
  load: (id: TaskId) => id === 'task-1' ? { parent } : undefined,
} as unknown as SqliteFusionStore)

const profileStub = () => ({
  profile: {
    lead: { provider: 'cpa', model: 'glm-5.3-flash' },
    worker: { provider: 'cpa', model: 'devin/swe-2-flash' },
  },
}) as unknown as ResolvedProfile

const workOrder = (over: Partial<WorkOrder> = {}): WorkOrder => ({
  schemaVersion: 1, taskId: 'task-1' as TaskId, id: 'wo-1' as WorkOrder['id'],
  operationId: 'op-1' as WorkOrder['operationId'], revision: 1,
  goal: 'implement the thing',
  constraints: [{ id: 'c1', text: 'keep tests green', source: 'user' as never, provenance: 'user' as const, mandatory: true }],
  acceptance: [], allowedPaths: ['src/', 'tests/'], forbiddenActions: [],
  baseSnapshot: 'snap-1' as WorkOrder['baseSnapshot'], evidence: [], decisions: [], uncertainties: [],
  policy: {} as WorkOrder['policy'], ...over,
})

describe('V2Shadow', () => {
  it('projects work-order/prepared as worker generation + assignment', () => {
    const file = path('db.sqlite')
    migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      seeded(manager)
      const shadow = new V2Shadow(manager, storeStub(), profileStub)
      shadow.handle('task-1' as TaskId, 'work-order/prepared', { order: workOrder(), reservedChild: 'child-1' })

      const state = manager.getState()
      const assignment = Object.values(state.assignments).find(a => a.assignmentId === 'wo-wo-1')
      expect(assignment).toBeDefined()
      expect(assignment!.role).toBe('WORKER')
      expect(assignment!.workerAgentId).toBe('child-1')
      expect(assignment!.objective).toBe('implement the thing')
      expect(assignment!.constraints).toEqual(['keep tests green'])
      expect(state.generations[`gen-lead-${RUN}`]?.status).toBe('ACTIVE')
      expect(state.generations[`gen-worker-${RUN}-wo-1`]?.status).toBe('ACTIVE')
      expect(state.runs[RUN]!.agentIds).toContain('session-1')
      expect(state.runs[RUN]!.agentIds).toContain('child-1')
    } finally { manager.close() }
  })

  it('projects report/submitted and task/completed to assignment lifecycle', () => {
    const file = path('db.sqlite')
    migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      seeded(manager)
      const shadow = new V2Shadow(manager, storeStub(), profileStub)
      shadow.handle('task-1' as TaskId, 'work-order/prepared', { order: workOrder(), reservedChild: 'child-1' })
      shadow.handle('task-1' as TaskId, 'report/submitted', {
        operationId: 'op-1',
        report: { schemaVersion: 1, workOrderId: 'wo-1', revision: 1, status: 'completed',
          summary: 'done', snapshot: 'snap', changeManifest: { id: 'digest-1' }, coverage: [], verification: [], unresolved: [], questions: [] },
      })
      const state1 = manager.getState()
      const report = Object.values(state1.reports).find(r => r.reportId === 'wr-op-1')
      expect(report?.status).toBe('COMPLETED')
      expect(report?.generationId).toBe(`gen-worker-${RUN}-wo-1`)

      shadow.handle('task-1' as TaskId, 'task/completed', {})
      expect(manager.getState().assignments['wo-wo-1']?.status).toBe('COMPLETED')
    } finally { manager.close() }
  })

  it('projects scope expansion and lead review as brief revision + arbitration', () => {
    const file = path('db.sqlite')
    migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      seeded(manager)
      const shadow = new V2Shadow(manager, storeStub(), profileStub)
      shadow.handle('task-1' as TaskId, 'work-order/prepared', { order: workOrder(), reservedChild: 'child-1' })
      shadow.handle('task-1' as TaskId, 'work-order/scope-expanded', {
        workOrderId: 'wo-1', added: ['lib/'], reason: 'worker needs lib' })
      const assignment = manager.getState().assignments['wo-wo-1']!
      expect(assignment.briefRevision).toBe(2)
      expect(assignment.constraints).toContain('scope-expanded: lib/')

      shadow.handle('task-1' as TaskId, 'review/completed', { decision: 'rework' })
      expect(manager.getState().assignments['wo-wo-1']!.arbitration?.ruling).toBe('REWORK')
    } finally { manager.close() }
  })

  it('journals file claims so a sibling run claim is rejected', () => {
    const file = path('db.sqlite')
    migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      seeded(manager)
      const shadow = new V2Shadow(manager, storeStub(), profileStub)
      shadow.handle('task-1' as TaskId, 'work-order/prepared', { order: workOrder(), reservedChild: 'child-1' })
      expect(manager.getState().assignments['wo-wo-1']!.claimedPaths).toEqual(['src/', 'tests/'])

      // A second run on a fork sibling claims the same prefix → rejected by the reducer.
      const RUN2 = FusionRunId('fusion-run-session-2')
      manager.append(event({ type: 'RUN_CREATED', runId: RUN2, hostSessionId: 'session-2',
        taskId: 'task-2', budgetId: 'budget-2', mode: 'DIRECT', branchId: 'branch-2' }, 'e-3'), 0)
      manager.append(event({ type: 'RUN_ACTIVATED', runId: RUN2, hostSessionId: 'session-2' }, 'e-4'), 1)
      const shadow2 = new V2Shadow(manager, {
        load: (id: TaskId) => id === 'task-2' ? { parent: 'session-2' } : undefined,
      } as unknown as SqliteFusionStore, profileStub)
      expect(() => shadow2.handle('task-2' as TaskId, 'work-order/prepared', { order: workOrder(), reservedChild: 'child-2' })).not.toThrow()
      // The overlapping claim was rejected — only the original claim stands.
      expect(manager.getState().assignments['wo-wo-1']!.claimedPaths).toEqual(['src/', 'tests/'])
    } finally { manager.close() }
  })

  it('shadow failures never throw to the caller and unknown events are ignored', () => {
    const file = path('db.sqlite')
    migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      seeded(manager)
      // store.load returns undefined → no run resolution → silent no-op.
      const broken = new V2Shadow(manager, storeStub('nonexistent-session'), profileStub)
      expect(() => broken.handle('task-1' as TaskId, 'work-order/prepared',
        { order: workOrder(), reservedChild: 'c' })).not.toThrow()
      expect(() => broken.handle('task-1' as TaskId, 'task/paused', { reason: 'x' })).not.toThrow()
      expect(manager.getState().seq).toBe(2) // only the two seed events
    } finally { manager.close() }
  })

  it('survives restart — projected assignments replay from the journal', () => {
    const file = path('db.sqlite')
    migrateFusionV2(file)
    const m1 = openRunManager(file)
    try {
      seeded(m1)
      new V2Shadow(m1, storeStub(), profileStub)
        .handle('task-1' as TaskId, 'work-order/prepared', { order: workOrder(), reservedChild: 'child-1' })
    } finally { m1.close() }
    const m2 = openRunManager(file)
    try {
      expect(m2.getState().assignments['wo-wo-1']?.workerAgentId).toBe('child-1')
    } finally { m2.close() }
  })
})
