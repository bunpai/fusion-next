import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { SessionLifecycle } from '../src/session/lifecycle.js'
import { SessionFork } from '../src/session/fork.js'
import { SessionSuspension } from '../src/session/suspension.js'
import { EffectLedger, effectFingerprint } from '../src/effects/ledger.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-c03-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const generation = AgentGenerationId('gen-1')
const routeA: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const routeB: ModelRoute = { provider: 'beta', model: 'b1', capabilityDigest: 'digest-b' }

const observedAllTrue: HostCapabilityInput['observed'] = {
  sessionRead: true, sessionFork: true, forkLineage: true, sessionRebind: true, rebindAtomic: true,
  lifecycleEvents: true, lifecycleOrdering: true, approvalRequest: true, approvalTurnOpen: true,
  compactionControl: true, compactionTransaction: true, effectObservation: true,
  effectOutcomeKnown: true, effectIdempotency: true,
}
const rc5 = () => probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: observedAllTrue })

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>

/** Per-run CAS revision advances with every append on that run. */
const rev = (manager: RunManager, runId: FusionRunId): number => {
  const current = manager.getState().runs[runId]
  if (!current) throw new Error(`test bug: run ${runId} missing`)
  return current.revision
}

function seeded(): { manager: RunManager; fork: SessionFork; lifecycle: SessionLifecycle; ledger: EffectLedger } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  manager.append(event({ type: 'GENERATION_PREPARED', runId: run, generationId: generation, agentId: 'agent-1', sessionId: 'native-1',
    route: routeA, epoch: 1 }, 'seed-generation'), 2)
  manager.append(event({ type: 'GENERATION_ACTIVATED', runId: run, generationId: generation }, 'seed-generation-active'), 3)
  const report = rc5()
  return { manager, fork: new SessionFork(manager, report), lifecycle: new SessionLifecycle(manager, report), ledger: new EffectLedger(manager) }
}

function prepareBranchGeneration(manager: RunManager, branchRunId: FusionRunId, agentId: string, suffix: string, route: ModelRoute): void {
  const prepared = event({ type: 'GENERATION_PREPARED', runId: branchRunId, generationId: AgentGenerationId(`gen-${suffix}`),
    agentId, sessionId: `native-${suffix}`, route, epoch: 1 }, `gen-${suffix}-prepared`)
  manager.append(prepared as RunEventInput, rev(manager, branchRunId))
  const activated = event({ type: 'GENERATION_ACTIVATED', runId: branchRunId, generationId: AgentGenerationId(`gen-${suffix}`) }, `gen-${suffix}-activated`)
  manager.append(activated as RunEventInput, rev(manager, branchRunId))
}

describe('C03 fork lineage, copy-on-write context, no inherited authority', () => {
  it('S08: forking an ordinary session records nothing; the branch activates Fusion independently', () => {
    const { manager, fork, lifecycle } = seeded()
    try {
      const stranger = SessionAliasId('session-plain')
      expect(fork.fork(stranger, { hostSessionId: 'session-plain-b', branchId: 'b-plain' })).toEqual({ fused: false })
      const outcome = lifecycle.activate('session-plain-b', { kind: 'create', taskId: 'task-plain', budgetId: 'budget-plain', mode: 'DIRECT', branchId: 'b-plain-root' })
      expect(outcome).toMatchObject({ created: true, runId: FusionRunId('fusion-run-session-plain-b') })
    } finally { manager.close() }
  })

  it('S09/S10: forking a Fusion run creates a fresh suspended run with copied route intent and lineage', () => {
    const { manager, fork } = seeded()
    try {
      const outcome = fork.fork(session, { hostSessionId: 'session-1-b', branchId: 'b1' })
      expect(outcome).toMatchObject({ fused: true, runId: FusionRunId('fusion-run-session-1-b'), branchId: 'b1', forkPointSeq: 4, inheritedRoute: routeA })
      const branchRun = manager.getRun(FusionRunId('fusion-run-session-1-b'))
      expect(branchRun).toMatchObject({ status: 'SUSPENDED', taskId: 'task-1#b1', budgetId: 'budget-1#b1', agentIds: ['agent-b1'], pendingApprovalIds: [], activeLeaseIds: [] })
      expect(manager.getState().lineage['b1']).toEqual({ branchId: 'b1', parentRunId: run, parentBranchId: 'root', forkPointSeq: 4 })
      expect(manager.getAlias(SessionAliasId('session-1-b'))).toMatchObject({ runId: FusionRunId('fusion-run-session-1-b'), selectionStatus: 'INACTIVE' })
      expect(manager.foreignKeyViolations()).toEqual([])
    } finally { manager.close() }
  })

  it('S11: the branch prepares and activates its own generation with a different route', () => {
    const { manager, fork, lifecycle } = seeded()
    try {
      const branchRun = FusionRunId('fusion-run-session-1-b')
      fork.fork(session, { hostSessionId: 'session-1-b', branchId: 'b1' })
      expect(lifecycle.activate('session-1-b', { kind: 'restore' })).toMatchObject({ resumed: true })
      prepareBranchGeneration(manager, branchRun, 'agent-b1', 'b1', routeB)
      expect(manager.getRun(branchRun)?.currentGenerationIds).toEqual({ 'agent-b1': 'gen-b1' })
      expect(manager.getState().generations['gen-b1'].route).toEqual(routeB)
      // The parent generation stayed untouched: no identity or route reuse across runs.
      expect(manager.getRun(run)?.currentGenerationIds).toEqual({ 'agent-1': 'gen-1' })
    } finally { manager.close() }
  })

  it('S12: two branches run concurrently in their own host sessions', () => {
    const { manager, fork, lifecycle } = seeded()
    try {
      fork.fork(session, { hostSessionId: 'session-b1', branchId: 'b1' })
      fork.fork(session, { hostSessionId: 'session-b2', branchId: 'b2' })
      expect(lifecycle.activate('session-b1', { kind: 'restore' })).toMatchObject({ resumed: true })
      expect(lifecycle.activate('session-b2', { kind: 'restore' })).toMatchObject({ resumed: true })
      expect(manager.getRun(FusionRunId('fusion-run-session-b1'))?.status).toBe('RUNNING')
      expect(manager.getRun(FusionRunId('fusion-run-session-b2'))?.status).toBe('RUNNING')
      // The parent is still RUNNING under its own session: three concurrent active runs, distinct sessions.
      expect(manager.getRun(run)?.status).toBe('RUNNING')
    } finally { manager.close() }
  })

  it('S13: suspending one branch leaves the other branch running', () => {
    const { manager, fork, lifecycle, ledger } = seeded()
    const suspension = new SessionSuspension(manager, ledger, rc5(), lifecycle)
    try {
      fork.fork(session, { hostSessionId: 'session-b1', branchId: 'b1' })
      fork.fork(session, { hostSessionId: 'session-b2', branchId: 'b2' })
      lifecycle.activate('session-b1', { kind: 'restore' })
      lifecycle.activate('session-b2', { kind: 'restore' })
      expect(suspension.suspend(SessionAliasId('session-b1')).suspended).toBe(true)
      expect(manager.getRun(FusionRunId('fusion-run-session-b1'))?.status).toBe('SUSPENDED')
      expect(manager.getRun(FusionRunId('fusion-run-session-b2'))?.status).toBe('RUNNING')
    } finally { manager.close() }
  })

  it('S19: two branches claiming the same effect identity conflict instead of double-executing', () => {
    const { manager, fork, lifecycle, ledger } = seeded()
    try {
      const b1 = FusionRunId('fusion-run-session-b1')
      const b2 = FusionRunId('fusion-run-session-b2')
      fork.fork(session, { hostSessionId: 'session-b1', branchId: 'b1' })
      fork.fork(session, { hostSessionId: 'session-b2', branchId: 'b2' })
      lifecycle.activate('session-b1', { kind: 'restore' })
      lifecycle.activate('session-b2', { kind: 'restore' })
      prepareBranchGeneration(manager, b1, 'agent-b1', 'b1', routeA)
      prepareBranchGeneration(manager, b2, 'agent-b2', 'b2', routeA)
      // Same logical external write claimed from two branches: the second intent is rejected so the
      // side effect cannot be executed twice under one idempotency identity. (Worktree-level write
      // coordination itself is the K01/K03 scope.)
      const key = effectFingerprint('write_file', { path: '/w/shared.txt' }, '/w')
      const intentFor = (effectId: string, generationId: AgentGenerationId) =>
        ({ effectId, generationId, toolCallId: 'call-1', effectClass: 'IDEMPOTENT' as const, fingerprint: key, idempotencyKey: `shared-write:${key}` })
      ledger.recordIntent(b1, intentFor('fx-b1', AgentGenerationId('gen-b1')), rev(manager, b1))
      expect(() => ledger.recordIntent(b2, intentFor('fx-b2', AgentGenerationId('gen-b2')), rev(manager, b2)))
        .toThrow(/idempotency key already exists/)
    } finally { manager.close() }
  })

  it('S20: parent events after the fork point never leak into the branch', () => {
    const { manager, fork } = seeded()
    try {
      const outcome = fork.fork(session, { hostSessionId: 'session-1-b', branchId: 'b1' })
      const forkPoint = outcome.forkPointSeq as number
      // Parent-only activity after the fork point: a suspend/resume cycle on the parent run.
      manager.append(event({ type: 'RUN_SUSPEND_REQUESTED', runId: run }, 'parent-suspend') as RunEventInput, rev(manager, run))
      manager.append(event({ type: 'RUN_SUSPENDED', runId: run }, 'parent-suspended') as RunEventInput, rev(manager, run))
      manager.append(event({ type: 'RUN_RESTORE_REQUESTED', runId: run, hostSessionId: session }, 'parent-restore') as RunEventInput, rev(manager, run))
      manager.append(event({ type: 'RUN_RESTORED', runId: run, hostSessionId: session }, 'parent-restored') as RunEventInput, rev(manager, run))
      const branch = manager.getRun(FusionRunId('fusion-run-session-1-b'))
      expect(branch?.agentIds).toEqual(['agent-b1'])
      expect(branch?.currentGenerationIds).toEqual({})
      expect(branch?.status).toBe('SUSPENDED')
      expect(Object.values(manager.getState().generations).filter(g => g.runId === FusionRunId('fusion-run-session-1-b'))).toEqual([])
      expect(manager.getState().lineage['b1'].forkPointSeq).toBe(forkPoint)
      expect(manager.foreignKeyViolations()).toEqual([])
    } finally { manager.close() }
  })

  it('rejects forks onto bound sessions and rc2/unknown versions', () => {
    const { manager, fork } = seeded()
    try {
      expect(() => fork.fork(session, { hostSessionId: 'session-1', branchId: 'b-x' })).toThrow(/already has a Fusion binding/)
      const denied = new SessionFork(manager, probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: {} }))
      expect(() => denied.fork(session, { hostSessionId: 'session-z', branchId: 'b-z' })).toThrow(/HOST_CAPABILITY_DENIED/)
      expect(() => fork.fork(session, { hostSessionId: 'session-1-b', branchId: '' })).toThrow(TypeError)
      expect(manager.getAlias(SessionAliasId('session-z'))).toBeUndefined()
    } finally { manager.close() }
  })
})
