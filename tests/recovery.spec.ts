import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { EffectLedger } from '../src/effects/ledger.js'
import { TransitionService } from '../src/transition/service.js'
import { RecoveryCoordinator } from '../src/integration/recovery.js'
import { WorktreeManager } from '../src/worktree/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-h03-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const route: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const betaRoute: ModelRoute = { provider: 'beta', model: 'b1', capabilityDigest: 'digest-b' }
const observedAllTrue: HostCapabilityInput['observed'] = {
  sessionRead: true, sessionFork: true, forkLineage: true, sessionRebind: true, rebindAtomic: true,
  lifecycleEvents: true, lifecycleOrdering: true, approvalRequest: true, approvalTurnOpen: true,
  compactionControl: true, compactionTransaction: true, effectObservation: true,
  effectOutcomeKnown: true, effectIdempotency: true,
}
const rc5 = () => probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: observedAllTrue })
const alphaCapability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' }
const betaCapability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-b' }

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>

function seeded(): { file: string; manager: RunManager; registry: RouteCapabilityRegistry } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', alphaCapability)
  registry.declare('beta', 'b1', betaCapability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-lead', 'native-lead', AgentGenerationId('g-a'), route, {})
  generations.activate(run, AgentGenerationId('g-a'))
  return { file, manager, registry }
}

describe('H03 recovery: resumable transitions, effect classification and worktree cleanup', () => {
  it('resumes a transition that crashed after prepare without repeating committed steps', () => {
    const world = seeded()
    const { manager, registry } = world
    try {
      const ledger = new EffectLedger(manager)
      const transitions = new TransitionService(manager, rc5(), new GenerationService(manager, rc5(), registry), ledger, registry)
      const recovery = new RecoveryCoordinator(manager, transitions)
      const crashed = (() => {
        try {
          transitions.request(run, { transitionId: 't-1', agentId: 'agent-lead', mode: 'CROSS_PROVIDER',
            fromGenerationId: AgentGenerationId('g-a'), to: { generationId: AgentGenerationId('g-b'), sessionId: 'native-b', route: betaRoute, requirements: {} } },
            { crashAfter: 'prepare' })
          return false
        } catch { return true }
      })()
      expect(crashed).toBe(true)
      const plan = recovery.plan('run-1')
      expect(plan.resumableTransitions).toHaveLength(1)
      expect(plan.resumableTransitions[0]).toMatchObject({ transitionId: 't-1', nextAction: 'resume' })
      expect(plan.blockedReasons).toEqual([])
      const outcome = recovery.resumeTransition('run-1', 't-1')
      if (outcome.outcome !== 'COMMITTED') throw new Error('test bug: expected commit')
      expect(outcome.phases).toEqual(['VALIDATED', 'QUIESCED', 'CHECKPOINTED', 'PREPARED', 'COMMITTED'])
      const state = manager.getState()
      expect(state.runs[run].currentGenerationIds['agent-lead']).toBe('g-b')
      expect(state.generations['g-b'].status).toBe('ACTIVE')
      expect(state.generations['g-a'].status).toBe('RETIRED')
      expect(recovery.plan('run-1').resumableTransitions).toEqual([])
    } finally { manager.close() }
  })

  it('classifies unsettled effects and never auto-retries dangerous classes', () => {
    const world = seeded()
    const { manager, registry } = world
    try {
      const ledger = new EffectLedger(manager)
      const transitions = new TransitionService(manager, rc5(), new GenerationService(manager, rc5(), registry), ledger, registry)
      const recovery = new RecoveryCoordinator(manager, transitions)
      ledger.recordIntent(run, { effectId: 'fx-i', generationId: AgentGenerationId('g-a'), toolCallId: 'tc-1', effectClass: 'IDEMPOTENT', fingerprint: 'f-i', idempotencyKey: 'k-i' }, manager.getRun(run)!.revision)
      ledger.recordIntent(run, { effectId: 'fx-n', generationId: AgentGenerationId('g-a'), toolCallId: 'tc-2', effectClass: 'NEEDS_VERIFICATION', fingerprint: 'f-n', idempotencyKey: 'k-n' }, manager.getRun(run)!.revision)
      ledger.recordIntent(run, { effectId: 'fx-r', generationId: AgentGenerationId('g-a'), toolCallId: 'tc-3', effectClass: 'NEVER_RETRY', fingerprint: 'f-r', idempotencyKey: 'k-r' }, manager.getRun(run)!.revision)
      ledger.dispatch(run, 'fx-i', manager.getRun(run)!.revision)
      ledger.dispatch(run, 'fx-n', manager.getRun(run)!.revision)
      ledger.dispatch(run, 'fx-r', manager.getRun(run)!.revision)
      const plan = recovery.plan('run-1')
      const byId = new Map(plan.unsettledEffects.map(effect => [effect.effectId, effect]))
      expect(byId.get('fx-i')).toMatchObject({ state: 'EXECUTING', safeToAutoRetry: true, action: 'redispatch' })
      expect(byId.get('fx-n')).toMatchObject({ state: 'EXECUTING', safeToAutoRetry: false, action: 'manual-verify' })
      expect(byId.get('fx-r')).toMatchObject({ state: 'EXECUTING', safeToAutoRetry: false, action: 'manual-reconcile' })
      expect(plan.blockedReasons.length).toBeGreaterThanOrEqual(2)
    } finally { manager.close() }
  })

  it('lists worktrees needing cleanup and restores the plan after restart', () => {
    const world = seeded()
    const { manager, registry, file } = world
    try {
      const worktrees = new WorktreeManager(manager, rc5())
      worktrees.acquire(run, { worktreeId: 'wt-1', generationId: 'g-a', path: '/repo/.worktrees/wt-1', branch: 'fusion/wt-1', baseCommit: 'abc' })
      worktrees.acquire(run, { worktreeId: 'wt-2', generationId: 'g-a', path: '/repo/.worktrees/wt-2', branch: 'fusion/wt-2', baseCommit: 'abc' })
      worktrees.rollback(run, 'wt-2', 'conflict')
      manager.close()
      const reopened = openRunManager(file)
      try {
        const ledger = new EffectLedger(reopened)
        const transitions = new TransitionService(reopened, rc5(), new GenerationService(reopened, rc5(), registry), ledger, registry)
        const recovery = new RecoveryCoordinator(reopened, transitions)
        const plan = recovery.plan('run-1')
        expect(plan.worktreesNeedingCleanup).toEqual([
          { worktreeId: 'wt-1', state: 'ACTIVE', path: '/repo/.worktrees/wt-1' },
          { worktreeId: 'wt-2', state: 'ROLLED_BACK', path: '/repo/.worktrees/wt-2' },
        ])
        expect(plan.resumableTransitions).toEqual([])
      } finally { reopened.close() }
    } finally { void manager }
  })

  it('refuses to resume a legacy checkpoint without a journaled target spec', () => {
    const world = seeded()
    const { manager, registry } = world
    try {
      const ledger = new EffectLedger(manager)
      const transitions = new TransitionService(manager, rc5(), new GenerationService(manager, rc5(), registry), ledger, registry)
      const recovery = new RecoveryCoordinator(manager, transitions)
      manager.append(event({ type: 'TRANSITION_CHECKPOINTED', runId: run, transitionId: 't-legacy', agentId: 'agent-lead',
        mode: 'MANUAL', fromGenerationId: 'g-a', toGenerationId: 'g-b' }, 'fusion/transition/t-legacy/checkpointed'), manager.getRun(run)!.revision)
      const plan = recovery.plan('run-1')
      expect(plan.resumableTransitions[0]).toMatchObject({ transitionId: 't-legacy', nextAction: 'blocked' })
      expect(() => recovery.resumeTransition('run-1', 't-legacy')).toThrow(/refusing to guess/)
    } finally { manager.close() }
  })
})
