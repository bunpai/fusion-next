import { describe, expect, it } from 'vitest'
import { AgentGenerationId, FusionRunId, SessionAliasId, reduceLifecycle, replayLifecycle, type LifecycleEvent } from '../src/lifecycle/index.js'

const run = FusionRunId('run-a'), child = FusionRunId('run-b')
const session = SessionAliasId('session-a'), childSession = SessionAliasId('session-b')
const generation = AgentGenerationId('gen-a'), replacement = AgentGenerationId('gen-b')
const route = { provider: 'p', model: 'm', capabilityDigest: 'cap' }
const create = { type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-a', budgetId: 'budget-a', mode: 'DIRECT', branchId: 'branch-a' } as const
const events = (items: readonly Record<string, unknown>[]): LifecycleEvent[] => items.map((item, index) => ({
  schemaVersion: 1, eventId: `event-${index + 1}`, seq: index + 1, expectedRevision: index, ...item,
})) as LifecycleEvent[]
const base = () => events([create, { type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }])

describe('Fusion Next B01 pure lifecycle', () => {
  it('replays creation and activation deterministically; retries identical event id without advancing', () => {
    const stream = base()
    const state = replayLifecycle(stream)
    expect(state.runs[run].status).toBe('RUNNING')
    expect(state.aliases[session].runId).toBe(run)
    expect(state.runs[run].revision).toBe(2)
    expect(reduceLifecycle(state, stream[1])).toEqual(state)
    expect(replayLifecycle(stream)).toEqual(state)
  })

  it('suspends and explicitly restores the existing run without erasing alias', () => {
    const state = replayLifecycle(events([create, { type: 'RUN_ACTIVATED', runId: run, hostSessionId: session },
      { type: 'RUN_SUSPEND_REQUESTED', runId: run }, { type: 'RUN_SUSPENDED', runId: run },
      { type: 'RUN_RESTORE_REQUESTED', runId: run, hostSessionId: session },
      { type: 'RUN_RESTORED', runId: run, hostSessionId: session }]))
    expect(state.runs[run].status).toBe('RUNNING')
    expect(state.aliases[session].selectionStatus).toBe('ACTIVE')
  })

  it('forks to independent run/task/agent/budget and excludes transient authority', () => {
    const stream = events([create, { type: 'RUN_ACTIVATED', runId: run, hostSessionId: session },
      { type: 'GENERATION_PREPARED', runId: run, generationId: generation, agentId: 'agent-a', sessionId: 'native-a', route, epoch: 1 },
      { type: 'GENERATION_ACTIVATED', runId: run, generationId: generation },
      { type: 'SESSION_FORKED', runId: child, hostSessionId: childSession, sourceRunId: run,
        sourceHostSessionId: session, branchId: 'branch-b', forkPointSeq: 2,
        taskId: 'task-b', budgetId: 'budget-b', agentId: 'agent-b', mode: 'DIRECT' }])
    const state = replayLifecycle(stream)
    expect(state.runs[child]).toMatchObject({ taskId: 'task-b', budgetId: 'budget-b', status: 'SUSPENDED' })
    expect(state.runs[run].status).toBe('RUNNING')
    expect(state.aliases[childSession]).toMatchObject({ runId: child, selectionStatus: 'INACTIVE' })
    expect(state.lineage['branch-b']).toMatchObject({ parentRunId: run, parentBranchId: 'branch-a', forkPointSeq: 2 })
    expect(state.generations[generation].runId).toBe(run)
    expect(state.runs[child].currentGenerationId).toBeUndefined()
    expect(state.runs[child].agentIds).toEqual(['agent-b'])
    expect(state.runs[child].pendingApprovalIds).toEqual([])
    expect(state.runs[child].activeLeaseIds).toEqual([])
  })

  it('enforces PREPARING → ACTIVE → DRAINING → RETIRED and old callback fencing', () => {
    const prefix = events([create, { type: 'RUN_ACTIVATED', runId: run, hostSessionId: session },
      { type: 'GENERATION_PREPARED', runId: run, generationId: generation, agentId: 'agent-a', sessionId: 'native-a', route, epoch: 1 },
      { type: 'GENERATION_ACTIVATED', runId: run, generationId: generation },
      { type: 'GENERATION_DRAINING', runId: run, generationId: generation },
      { type: 'GENERATION_RETIRED', runId: run, generationId: generation },
      { type: 'GENERATION_PREPARED', runId: run, generationId: replacement, agentId: 'agent-a', sessionId: 'native-b', route, epoch: 2 },
      { type: 'GENERATION_ACTIVATED', runId: run, generationId: replacement }])
    const state = replayLifecycle(prefix)
    expect(state.generations[generation].status).toBe('RETIRED')
    expect(state.generations[replacement].status).toBe('ACTIVE')
    expect(state.runs[run].currentGenerationId).toBe(replacement)
    expect(() => reduceLifecycle(state, { ...events([{ type: 'GENERATION_CALLBACK', runId: run, generationId: generation }])[0], seq: 9, expectedRevision: 8, eventId: 'late-callback' })).toThrow(/fenced/i)
  })

  it.each([
    ['activation skipping creation', [{ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }]],
    ['suspend without barrier', [create, { type: 'RUN_SUSPENDED', runId: run }]],
    ['restore without suspended', [create, { type: 'RUN_RESTORED', runId: run, hostSessionId: session }]],
    ['generation skipping prepare', [create, { type: 'GENERATION_ACTIVATED', runId: run, generationId: generation }]],
    ['generation skipping drain', [create, { type: 'GENERATION_PREPARED', runId: run, generationId: generation, agentId: 'a', sessionId: 's', route, epoch: 1 }, { type: 'GENERATION_RETIRED', runId: run, generationId: generation }]],
    ['fork colliding session', [create, { type: 'SESSION_FORKED', runId: child, hostSessionId: session, sourceRunId: run, sourceHostSessionId: session, branchId: 'b', forkPointSeq: 1, taskId: 't', budgetId: 'b', agentId: 'a', mode: 'DIRECT' }]],
  ])('rejects illegal %s', (_name, items) => {
    expect(() => replayLifecycle(events(items))).toThrow()
  })

  it('rejects stale revision, out-of-order seq, and reused event ids with different contents', () => {
    const state = replayLifecycle(base())
    const next = { ...events([{ type: 'RUN_SUSPEND_REQUESTED', runId: run }])[0], seq: 3, expectedRevision: 1, eventId: 'new-suspend' }
    expect(() => reduceLifecycle(state, next)).toThrow(/revision/i)
    expect(() => reduceLifecycle(state, { ...next, expectedRevision: 2, seq: 4 })).toThrow(/seq/i)
    expect(() => reduceLifecycle(state, { ...next, eventId: 'event-1', expectedRevision: 2 })).toThrow(/event id/i)
  })

  it('does not let activation bypass the suspend/restore transaction', () => {
    const state = replayLifecycle(events([create, { type: 'RUN_ACTIVATED', runId: run, hostSessionId: session },
      { type: 'RUN_SUSPEND_REQUESTED', runId: run }, { type: 'RUN_SUSPENDED', runId: run }]))
    expect(() => reduceLifecycle(state, { ...events([{ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }])[0],
      eventId: 'bypass', seq: 5, expectedRevision: 4 })).toThrow(/activation/)
  })

  it('isolates branches when source continues and child independently activates', () => {
    const stream = events([create, { type: 'RUN_ACTIVATED', runId: run, hostSessionId: session },
      { type: 'SESSION_FORKED', runId: child, hostSessionId: childSession, sourceRunId: run, sourceHostSessionId: session, branchId: 'branch-b', forkPointSeq: 2, taskId: 'task-b', budgetId: 'budget-b', agentId: 'agent-b', mode: 'DIRECT' },
      { type: 'RUN_ACTIVATED', runId: child, hostSessionId: childSession },
      { type: 'RUN_SUSPEND_REQUESTED', runId: child }, { type: 'RUN_SUSPENDED', runId: child }])
    const state = replayLifecycle(stream)
    expect(state.runs[run].status).toBe('RUNNING')
    expect(state.runs[child].status).toBe('SUSPENDED')
    expect(state.aliases[session].selectionStatus).toBe('ACTIVE')
  })
})