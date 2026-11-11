import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { TransitionService } from '../src/transition/service.js'
import { RecoveryCoordinator } from '../src/integration/recovery.js'
import { EffectLedger } from '../src/effects/ledger.js'
import { LiveMonitor } from '../src/monitor/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-k02-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const childSession = SessionAliasId('session-child')
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

function seeded(): { file: string; manager: RunManager; generations: GenerationService; transitions: TransitionService; ledger: EffectLedger } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-lead', 'native-lead', AgentGenerationId('g-1'), route, {})
  generations.activate(run, AgentGenerationId('g-1'))
  const ledger = new EffectLedger(manager)
  const transitions = new TransitionService(manager, rc5(), generations, ledger, registry)
  return { file, manager, generations, transitions, ledger }
}

describe('K02 live monitor views, replay and recovery interaction', () => {
  it('shows run identity, generations, effects and transition progress in one snapshot', () => {
    const world = seeded()
    const { manager, generations, ledger } = world
    try {
      ledger.recordIntent(run, { effectId: 'fx-1', generationId: AgentGenerationId('g-1'), toolCallId: 'call-1',
        effectClass: 'NEVER_RETRY', fingerprint: 'fp', idempotencyKey: 'k-1' }, manager.getRun(run)!.revision)
      const monitor = new LiveMonitor(manager)
      const view = monitor.runView(run)
      expect(view).toMatchObject({ runId: run, status: 'RUNNING', currentGenerationId: 'g-1', task: 'task-1', mode: 'DIRECT' })
      expect(view.generations).toEqual([{ id: 'g-1', agentId: 'agent-lead', epoch: 1, status: 'ACTIVE', route }])
      expect(view.unsettledEffects).toEqual(['fx-1:INTENT'])
      void generations
    } finally { manager.close() }
  })

  it('renders the fork lineage tree for the history/branch view', () => {
    const world = seeded()
    const { manager } = world
    try {
      manager.append(event({ type: 'SESSION_FORKED', runId: FusionRunId('run-2'), hostSessionId: childSession,
        sourceRunId: run, sourceHostSessionId: session, branchId: 'child', forkPointSeq: 2,
        taskId: 'task-1#child', budgetId: 'budget-1#child', agentId: 'agent-child', mode: 'DIRECT' }, 'fork-1'), 0)
      const monitor = new LiveMonitor(manager)
      // Only forks record lineage; the root branch identity lives on the run itself.
      expect(monitor.branchView()).toEqual([{ branchId: 'child', parentBranchId: 'root', forkPointSeq: 2 }])
    } finally { manager.close() }
  })

  it('replays journaled events from a durable cursor', () => {
    const world = seeded()
    const { manager } = world
    try {
      const monitor = new LiveMonitor(manager)
      const first = monitor.replayFrom(0)
      expect(first.events.length).toBeGreaterThanOrEqual(2)
      expect(first.events[0].cursor).toBe(1)
      const resumed = monitor.replayFrom(first.events[first.events.length - 1].cursor)
      expect(resumed.events).toEqual([])
    } finally { manager.close() }
  })

  it('surfaces recovery plans: resumable transitions and unsettled effects stay visible', () => {
    const world = seeded()
    const { manager, transitions, generations, ledger } = world
    try {
      generations.prepare(run, 'agent-worker', 'native-worker', AgentGenerationId('g-w'), route, {})
      generations.activate(run, AgentGenerationId('g-w'))
      ledger.recordIntent(run, { effectId: 'fx-1', generationId: AgentGenerationId('g-1'), toolCallId: 'call-1',
        effectClass: 'IDEMPOTENT', fingerprint: 'fp', idempotencyKey: 'k-1' }, manager.getRun(run)!.revision)
      const monitor = new LiveMonitor(manager)
      const progress = monitor.transitionProgress(run)
      expect(progress.blockedByEffects).toEqual(['fx-1:INTENT'])
      const recovery = new RecoveryCoordinator(manager, transitions)
      expect(recovery.plan(run).resumableTransitions).toEqual([])
      expect(progress.transitions).toEqual([])
    } finally { manager.close() }
  })

  it('never renders recovering runs as normally executing and blocks risky user actions', () => {
    const world = seeded()
    const { manager } = world
    try {
      const rev = () => manager.getRun(run)!.revision
      manager.append(event({ type: 'RUN_SUSPEND_REQUESTED', runId: run, hostSessionId: session }, 's-1'), rev())
      manager.append(event({ type: 'RUN_SUSPENDED', runId: run, hostSessionId: session }, 's-2'), rev())
      manager.append(event({ type: 'RUN_RESTORE_REQUESTED', runId: run, hostSessionId: session }, 's-3'), rev())
      const monitor = new LiveMonitor(manager)
      const view = monitor.renderState(run)
      expect(view.displayStatus).toBe('RECOVERING')
      expect(view.isRecovering).toBe(true)
      expect(() => monitor.assertUserActionAllowed(run, 'switch-model')).toThrow(/RECOVERY_IN_PROGRESS/)
      expect(monitor.assertUserActionAllowed(run, 'view-effects')).toBe(true)
    } finally { manager.close() }
  })
})
