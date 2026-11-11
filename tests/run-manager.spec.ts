import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent } from '../src/lifecycle/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-b03-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const run = FusionRunId('run-1'), child = FusionRunId('run-2')
const session = SessionAliasId('session-1'), childSession = SessionAliasId('session-2')
const create = { type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' } as const
const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> => ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>

describe('B03 transactional run manager', () => {
  it('requires explicit v2 migration and persists a run projection', () => {
    const file = path()
    expect(() => openRunManager(file)).toThrow(/migrat|missing|v2/i)
    migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const state = manager.append(event(create, 'created'), 0)
      expect(state.runs[run].revision).toBe(1)
      expect(manager.getRun(run)?.status).toBe('ACTIVATING')
      expect(manager.getAlias(session)?.runId).toBe(run)
      expect(manager.listEvents(run)).toHaveLength(1)
    } finally { manager.close() }
  })

  it('uses per-run revisions and sequences across independent runs', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      manager.append(event(create, 'a-create'), 0)
      const other = { ...create, runId: child, hostSessionId: childSession, taskId: 'task-2', budgetId: 'budget-2', branchId: 'other' }
      manager.append(event(other, 'b-create'), 0)
      manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'a-active'), 1)
      expect(manager.listEvents(run).map(e => e.seq)).toEqual([1, 2])
      expect(manager.listEvents(child).map(e => e.seq)).toEqual([1])
      expect(manager.getRun(run)?.revision).toBe(2)
      expect(manager.getRun(child)?.revision).toBe(1)
    } finally { manager.close() }
  })

  it('rejects stale CAS and conflicting id reuse, while identical retry is idempotent', () => {
    const file = path(); migrateFusionV2(file)
    const a = openRunManager(file), b = openRunManager(file)
    try {
      const input = event(create, 'once')
      a.append(input, 0)
      expect(b.append(input, 0).runs[run].revision).toBe(1)
      expect(() => b.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'stale'), 0)).toThrow(/revision|CAS/i)
      expect(() => b.append(event({ ...create, taskId: 'different' }, 'once'), 1)).toThrow(/event id|conflict/i)
      expect(a.listEvents(run)).toHaveLength(1)
    } finally { a.close(); b.close() }
  })

  it('reopens and replays cross-run fork while keeping parent intact', () => {
    const file = path(); migrateFusionV2(file)
    const a = openRunManager(file)
    a.append(event(create, 'root-create'), 0)
    a.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'root-active'), 1)
    a.append(event({ type: 'SESSION_FORKED', runId: child, hostSessionId: childSession, sourceRunId: run,
      sourceHostSessionId: session, branchId: 'child', forkPointSeq: 2, taskId: 'task-child', budgetId: 'budget-child',
      agentId: 'agent-child', mode: 'DIRECT' }, 'fork'), 0)
    a.close()
    const b = openRunManager(file)
    try {
      expect(b.getRun(run)?.status).toBe('RUNNING')
      expect(b.getRun(child)?.status).toBe('SUSPENDED')
      expect(b.getAlias(childSession)?.runId).toBe(child)
      expect(b.getState().lineage.child.parentRunId).toBe(run)
      expect(b.listEvents(child)).toHaveLength(1)
    } finally { b.close() }
  })

  it('rolls back both event insert and projection on injected crash before commit', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      expect(() => manager.append(event(create, 'crashed'), 0, { beforeCommit: () => { throw new Error('injected crash') } })).toThrow(/injected crash/)
      expect(manager.getRun(run)).toBeUndefined()
      expect(manager.listEvents(run)).toHaveLength(0)
      manager.append(event(create, 'retry'), 0)
      expect(manager.getRun(run)?.revision).toBe(1)
    } finally { manager.close() }
  })

  it('emits committed events exactly once and never publishes rolled-back attempts', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const received: string[] = []
      const unsubscribe = manager.subscribe(message => received.push(message.eventId))
      expect(() => manager.append(event(create, 'failed'), 0, { beforeCommit: () => { throw new Error('crash') } })).toThrow(/crash/)
      expect(received).toEqual([])
      manager.append(event(create, 'created'), 0)
      manager.append(event(create, 'created'), 0)
      expect(received).toEqual(['created'])
      unsubscribe()
      manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'activated'), 1)
      expect(received).toEqual(['created'])
    } finally { manager.close() }
  })

  it('persists generation per-agent projection with foreign keys intact', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      manager.append(event(create, 'create'), 0)
      manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'activate'), 1)
      const gen = AgentGenerationId('gen-1')
      manager.append(event({ type: 'GENERATION_PREPARED', runId: run, generationId: gen, agentId: 'agent-1', sessionId: 'native-1',
        route: { provider: 'mock', model: 'mock-1', capabilityDigest: 'cap' }, epoch: 1 }, 'prepared'), 2)
      expect(manager.getState().generations[gen].status).toBe('PREPARING')
      expect(manager.foreignKeyViolations()).toEqual([])
    } finally { manager.close() }
  })
})
