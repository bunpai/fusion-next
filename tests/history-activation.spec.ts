import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunManager } from '../src/run-manager/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { SessionLifecycle } from '../src/session/lifecycle.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-c01-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const observedAllTrue: HostCapabilityInput['observed'] = {
  sessionRead: true, sessionFork: true, forkLineage: true, sessionRebind: true, rebindAtomic: true,
  lifecycleEvents: true, lifecycleOrdering: true, approvalRequest: true, approvalTurnOpen: true,
  compactionControl: true, compactionTransaction: true, effectObservation: true,
  effectOutcomeKnown: true, effectIdempotency: true,
}
const rc5 = () => probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: observedAllTrue })
const rc2 = () => probeHostCapabilities({ sdkVersion: '0.2.1-rc.2', observed: observedAllTrue })
const createIntent = { kind: 'create' as const, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT' as const }
const restoreIntent = { kind: 'restore' as const }

describe('C01 session activation (S01/S02/S05)', () => {
  it('activates a new chat by creating the run before any model request', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const lifecycle = new SessionLifecycle(manager, rc5())
      const outcome = lifecycle.activate('chat-new', createIntent)
      expect(outcome).toMatchObject({ created: true, resumed: false, alreadyActive: false })
      const run = manager.getRun(outcome.runId)
      expect(run?.status).toBe('RUNNING')
      expect(run?.hasActivated).toBe(true)
      expect(manager.getAlias('chat-new' as never)?.selectionStatus).toBe('ACTIVE')
      expect(manager.listEvents(outcome.runId).map(event => event.type)).toEqual(['RUN_CREATED', 'RUN_ACTIVATED'])
    } finally { manager.close() }
  })

  it('treats repeated activation of a running session as an idempotent no-op', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const lifecycle = new SessionLifecycle(manager, rc5())
      const first = lifecycle.activate('chat-repeat', createIntent)
      const second = lifecycle.activate('chat-repeat', createIntent)
      expect(second).toMatchObject({ runId: first.runId, created: false, resumed: false, alreadyActive: true })
      expect(manager.listEvents(first.runId)).toHaveLength(2)
    } finally { manager.close() }
  })

  it('activates a history ordinary session only from an explicit menu intent', () => {
    // S05: the caller decides the intent; the session layer never infers Fusion
    // from the last physical request header. This test passes an explicit create
    // intent for a session that has no prior Fusion binding.
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const lifecycle = new SessionLifecycle(manager, rc5())
      const outcome = lifecycle.activate('history-ordinary', { ...createIntent, taskId: 'task-hist', budgetId: 'budget-hist' })
      expect(outcome.created).toBe(true)
      expect(manager.getRun(outcome.runId)?.status).toBe('RUNNING')
    } finally { manager.close() }
  })
})

describe('C01 history Fusion reopen and missing binding (S06/S18)', () => {
  it('reopens a history Fusion session by restoring the existing suspended run', () => {
    const file = path(); migrateFusionV2(file)
    const first = openRunManager(file)
    let runId: string
    try {
      const lifecycle = new SessionLifecycle(first, rc5())
      runId = lifecycle.activate('chat-history', createIntent).runId
      first.append({ schemaVersion: 1, eventId: 'susp-req', type: 'RUN_SUSPEND_REQUESTED', runId: first.getAlias('chat-history' as never)!.runId } as never, 2)
      first.append({ schemaVersion: 1, eventId: 'susp', type: 'RUN_SUSPENDED', runId } as never, 3)
    } finally { first.close() }
    const second = openRunManager(file)
    try {
      expect(second.getRun(runId as never)?.status).toBe('SUSPENDED')
      const lifecycle = new SessionLifecycle(second, rc5())
      const outcome = lifecycle.activate('chat-history', restoreIntent)
      expect(outcome).toMatchObject({ runId, created: false, resumed: false, alreadyActive: false })
      expect(second.getRun(runId as never)?.status).toBe('RUNNING')
      const types = second.listEvents(runId as never).map(event => event.type)
      expect(types).toEqual(['RUN_CREATED', 'RUN_ACTIVATED', 'RUN_SUSPEND_REQUESTED', 'RUN_SUSPENDED', 'RUN_RESTORE_REQUESTED', 'RUN_RESTORED'])
    } finally { second.close() }
  })

  it('fails closed with NEEDS_REPAIR when restoring a session without a legacy binding', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const lifecycle = new SessionLifecycle(manager, rc5())
      const before = manager.getState()
      expect(() => lifecycle.activate('ghost-session', restoreIntent)).toThrow(/NEEDS_REPAIR/)
      expect(manager.getState()).toEqual(before)
    } finally { manager.close() }
  })
})

describe('C01 capability gate', () => {
  it('denies activation on rc2 even when every capability flag is claimed', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const lifecycle = new SessionLifecycle(manager, rc2())
      const before = manager.getState()
      expect(() => lifecycle.activate('chat-rc2', createIntent)).toThrow(/HOST_CAPABILITY_DENIED/)
      expect(manager.getState()).toEqual(before)
      expect(manager.getState().aliases['chat-rc2']).toBeUndefined()
    } finally { manager.close() }
  })

  it('rejects forged capability reports without touching state', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const forged = probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: observedAllTrue })
      const lifecycle = new SessionLifecycle(manager, { ...forged } as typeof forged)
      expect(() => lifecycle.activate('chat-forged', createIntent)).toThrow(/untrusted/)
      expect(manager.getState().aliases['chat-forged']).toBeUndefined()
    } finally { manager.close() }
  })
})

describe('C01 interrupted activation resume', () => {
  it('completes an activation interrupted after run creation', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      // Simulate a crash between RUN_CREATED and RUN_ACTIVATED by replaying the
      // create step through the manager directly.
      manager.append({ schemaVersion: 1, eventId: 'fusion/session-alias/chat-crash/created', type: 'RUN_CREATED',
        runId: 'fusion-run-chat-crash', hostSessionId: 'chat-crash', taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT' } as never, 0)
      expect(manager.getRun('fusion-run-chat-crash' as never)?.status).toBe('ACTIVATING')
      const lifecycle = new SessionLifecycle(manager, rc5())
      const outcome = lifecycle.activate('chat-crash', createIntent)
      expect(outcome).toMatchObject({ runId: 'fusion-run-chat-crash', created: false, resumed: true, alreadyActive: false })
      expect(manager.getRun('fusion-run-chat-crash' as never)?.status).toBe('RUNNING')
    } finally { manager.close() }
  })

  it('completes a restore interrupted after the restore request', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const lifecycle = new SessionLifecycle(manager, rc5())
      const runId = lifecycle.activate('chat-resume-restore', createIntent).runId
      manager.append({ schemaVersion: 1, eventId: 'susp-req', type: 'RUN_SUSPEND_REQUESTED', runId } as never, 2)
      manager.append({ schemaVersion: 1, eventId: 'susp', type: 'RUN_SUSPENDED', runId } as never, 3)
      // Interrupted restore: only the request committed.
      manager.append({ schemaVersion: 1, eventId: 'fusion/restore-requested/fusion-run-chat-resume-restore/r4',
        type: 'RUN_RESTORE_REQUESTED', runId, hostSessionId: 'chat-resume-restore' } as never, 4)
      const resumed = new SessionLifecycle(manager, rc5()).activate('chat-resume-restore', restoreIntent)
      expect(resumed).toMatchObject({ runId, created: false, resumed: true, alreadyActive: false })
      expect(manager.getRun(runId)?.status).toBe('RUNNING')
    } finally { manager.close() }
  })
})

describe('C01 conflict fences', () => {
  it('refuses a create intent for a session already bound to a suspended run', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const lifecycle = new SessionLifecycle(manager, rc5())
      const runId = lifecycle.activate('chat-bound', createIntent).runId
      manager.append({ schemaVersion: 1, eventId: 'susp-req', type: 'RUN_SUSPEND_REQUESTED', runId } as never, 2)
      manager.append({ schemaVersion: 1, eventId: 'susp', type: 'RUN_SUSPENDED', runId } as never, 3)
      expect(() => lifecycle.activate('chat-bound', { ...createIntent, taskId: 'task-2', budgetId: 'budget-2' }))
        .toThrow(/SESSION_LIFECYCLE_CONFLICT.*restore/i)
      expect(manager.getRun(runId)?.status).toBe('SUSPENDED')
    } finally { manager.close() }
  })

  it('refuses activation while a suspend is still in progress', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const lifecycle = new SessionLifecycle(manager, rc5())
      const runId = lifecycle.activate('chat-suspending', createIntent).runId
      manager.append({ schemaVersion: 1, eventId: 'susp-req', type: 'RUN_SUSPEND_REQUESTED', runId } as never, 2)
      expect(() => lifecycle.activate('chat-suspending', restoreIntent)).toThrow(/SESSION_LIFECYCLE_CONFLICT/)
      expect(manager.getRun(runId)?.status).toBe('SUSPENDING')
    } finally { manager.close() }
  })

  it('serializes concurrent activations onto one run without duplication', () => {
    const file = path(); migrateFusionV2(file)
    const a = openRunManager(file), b = openRunManager(file)
    try {
      const lifecycleA = new SessionLifecycle(a, rc5())
      const lifecycleB = new SessionLifecycle(b, rc5())
      const intent = { ...createIntent, taskId: 'task-race', budgetId: 'budget-race' }
      const first = lifecycleA.activate('chat-race', intent)
      const second = lifecycleB.activate('chat-race', intent)
      expect(second.runId).toBe(first.runId)
      const state = a.getState()
      const bound = Object.values(state.runs).filter(run => run.hostSessionId === 'chat-race')
      expect(bound).toHaveLength(1)
      expect(bound[0]?.status).toBe('RUNNING')
      expect(a.listEvents(first.runId)).toHaveLength(2)
      expect(b.foreignKeyViolations()).toEqual([])
    } finally { a.close(); b.close() }
  })
})
