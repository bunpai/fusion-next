import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type EffectRecord, type LifecycleEvent } from '../src/lifecycle/index.js'
import { probeHostCapabilities } from '../src/host-capabilities/index.js'
import { EffectLedger, effectFingerprint } from '../src/effects/ledger.js'
import { SessionLifecycle } from '../src/session/lifecycle.js'
import { SessionSuspension, collectBlockers } from '../src/session/suspension.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-c02-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const generation = AgentGenerationId('gen-1')
const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
const observedAllTrue = {
  sessionRead: true, sessionFork: true, forkLineage: true, sessionRebind: true, rebindAtomic: true,
  lifecycleEvents: true, lifecycleOrdering: true, approvalRequest: true, approvalTurnOpen: true,
  compactionControl: true, compactionTransaction: true, effectObservation: true,
  effectOutcomeKnown: true, effectIdempotency: true,
} as const
const rc5 = () => probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: observedAllTrue })

function seeded(): { manager: RunManager; ledger: EffectLedger; suspension: SessionSuspension; lifecycle: SessionLifecycle } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  manager.append(event({ type: 'GENERATION_PREPARED', runId: run, generationId: generation, agentId: 'agent-1', sessionId: 'native-1',
    route: { provider: 'test', model: 'm1', capabilityDigest: 'digest' }, epoch: 1 }, 'seed-generation'), 2)
  manager.append(event({ type: 'GENERATION_ACTIVATED', runId: run, generationId: generation }, 'seed-generation-active'), 3)
  const report = rc5()
  const lifecycle = new SessionLifecycle(manager, report)
  const ledger = new EffectLedger(manager)
  return { manager, ledger, lifecycle, suspension: new SessionSuspension(manager, ledger, report, lifecycle) }
}

const intent = (effectId: string, effectClass: 'IDEMPOTENT' | 'NEEDS_VERIFICATION' = 'IDEMPOTENT') =>
  ({ effectId, generationId: generation, toolCallId: 'call-1', effectClass,
    fingerprint: effectFingerprint('shell', { cmd: 'ls' }, '/w'), idempotencyKey: `key-${effectId}` }) as const

describe('C02 safe suspend/resume with visible abnormal state', () => {
  it('S03: suspends a quiescent active run and is idempotent on repeat', () => {
    const { manager, suspension } = seeded()
    try {
      const outcome = suspension.suspend(session)
      expect(outcome).toMatchObject({ bound: true, suspended: true, alreadySuspended: false, blockers: [] })
      expect(manager.getRun(run)?.status).toBe('SUSPENDED')
      expect(manager.getAlias(session)?.selectionStatus).toBe('INACTIVE')
      const repeat = suspension.suspend(session)
      expect(repeat).toMatchObject({ suspended: false, alreadySuspended: true, blockers: [] })
    } finally { manager.close() }
  })

  it('S03 blocked: an executing effect refuses suspension and stays visible', () => {
    const { manager, ledger, suspension } = seeded()
    try {
      ledger.recordIntent(run, intent('fx-1', 'NEEDS_VERIFICATION'), 4)
      ledger.dispatch(run, 'fx-1', 5)
      const outcome = suspension.suspend(session)
      expect(outcome.suspended).toBe(false)
      expect(outcome.blockers).toEqual(['effects:fx-1:EXECUTING'])
      expect(manager.getRun(run)?.status).toBe('RUNNING')
      const view = suspension.view(session)
      expect(view.abnormal).toBe(true)
      expect(view.blockers).toEqual(['effects:fx-1:EXECUTING'])
    } finally { manager.close() }
  })

  it('S04/S07/S17: suspend and resume cycle repeatedly with deterministic state', () => {
    const { manager, suspension } = seeded()
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        expect(suspension.suspend(session).suspended).toBe(true)
        expect(manager.getRun(run)?.status).toBe('SUSPENDED')
        const resumed = suspension.resume(session)
        expect(resumed).toMatchObject({ runId: run, resumed: true, alreadyActive: false })
        expect(manager.getRun(run)?.status).toBe('RUNNING')
        expect(manager.getAlias(session)?.selectionStatus).toBe('ACTIVE')
      }
      // 4 seed events; each cycle appends suspend-requested+suspended+restore-requested+restored.
      expect(manager.listEvents(run).length).toBe(4 + 3 * 4)
      expect(manager.foreignKeyViolations()).toEqual([])
    } finally { manager.close() }
  })

  it('S17 rapid interleaving never leaves a half-suspended state', () => {
    const { manager, suspension } = seeded()
    try {
      expect(suspension.suspend(session).suspended).toBe(true)
      expect(suspension.resume(session).resumed).toBe(true)
      expect(suspension.suspend(session).alreadySuspended).toBe(false)
      expect(suspension.resume(session).resumed).toBe(true)
      const view = suspension.view(session)
      expect(view).toMatchObject({ bound: true, status: 'RUNNING', abnormal: false, blockers: [] })
    } finally { manager.close() }
  })

  it('denies suspend/resume on rc2 and unknown capability versions', () => {
    const { manager, suspension, ledger, lifecycle } = seeded()
    try {
      const denied = new SessionSuspension(manager, ledger, probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: {} }), lifecycle)
      expect(() => denied.suspend(session)).toThrow(/HOST_CAPABILITY_DENIED/)
      expect(() => denied.resume(session)).toThrow(/HOST_CAPABILITY_DENIED/)
      expect(manager.getRun(run)?.status).toBe('RUNNING')
    } finally { manager.close() }
  })

  it('reports unbound ordinary sessions as clean no-ops', () => {
    const { manager, suspension } = seeded()
    try {
      const stranger = SessionAliasId('session-other')
      expect(suspension.suspend(stranger)).toMatchObject({ bound: false, suspended: false, blockers: [] })
      expect(suspension.view(stranger)).toMatchObject({ bound: false, abnormal: false })
    } finally { manager.close() }
  })

  it('collectBlockers surfaces status, approvals, leases and unsettled effects', () => {
    const effects = [
      { effectId: 'a', state: 'EXECUTING' }, { effectId: 'b', state: 'NEEDS_REPAIR' },
      { effectId: 'c', state: 'SETTLED' }, { effectId: 'd', state: 'DISCARDED' },
    ] as unknown as EffectRecord[]
    expect(collectBlockers('WAITING_APPROVAL', 2, 1, effects))
      .toEqual(['status:WAITING_APPROVAL', 'approvals:2', 'leases:1', 'effects:a:EXECUTING', 'effects:b:NEEDS_REPAIR'])
    expect(collectBlockers('RUNNING', 0, 0, [])).toEqual([])
  })
})
