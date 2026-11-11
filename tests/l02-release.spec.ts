import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, replayLifecycle, emptyLifecycleState, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { TransitionService } from '../src/transition/service.js'
import { EffectLedger } from '../src/effects/ledger.js'
import { RecoveryCoordinator } from '../src/integration/recovery.js'
import { BudgetService, type PriceTable } from '../src/budget/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-l02-')); dirs.push(dir); return join(dir, 'fusion.db') }
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
const prices: PriceTable = { priceOf: () => ({ inputMicrosPerToken: 10, outputMicrosPerToken: 20, priceVersion: 'v1' }) }

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>

function seeded(): { file: string; manager: RunManager; generations: GenerationService; transitions: TransitionService; ledger: EffectLedger; budgets: BudgetService } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-lead', 'native-lead', AgentGenerationId('g-a'), route, {})
  generations.activate(run, AgentGenerationId('g-a'))
  const ledger = new EffectLedger(manager)
  const transitions = new TransitionService(manager, rc5(), generations, ledger, registry)
  const budgets = new BudgetService(manager, prices)
  budgets.reserve(run, 'budget-1', 1_000_000)
  return { file, manager, generations, transitions, ledger, budgets }
}

describe('L02 fault injection, performance smoke and security audit', () => {
  it('recovers from a crash at every transition stage without repeating committed steps', () => {
    for (const crashAfter of ['checkpoint', 'prepare'] as const) {
      const world = seeded()
      const { manager, transitions } = world
      try {
        const spec = { transitionId: `t-${crashAfter}`, agentId: 'agent-lead', mode: 'MANUAL' as const,
          fromGenerationId: AgentGenerationId('g-a'),
          to: { generationId: AgentGenerationId('g-b'), sessionId: 'native-lead-2', route, requirements: {} } }
        expect(() => transitions.request(run, spec, { crashAfter })).toThrow(/INJECTED_CRASH|crash/)
        const recovery = new RecoveryCoordinator(manager, transitions)
        const plan = recovery.plan(run)
        const resumable = plan.resumableTransitions.find((entry) => entry.transitionId === `t-${crashAfter}`)
        expect(resumable?.nextAction).toBe('resume')
        recovery.resumeTransition(run, `t-${crashAfter}`)
        const state = manager.getState()
        const record = state.transitions[`t-${crashAfter}`]
        expect(record.phase).toBe('COMMITTED')
      } finally { manager.close() }
    }
  })

  it('leaves no ledger or budget residue when the process dies before COMMIT', () => {
    const world = seeded()
    const { manager, ledger, budgets } = world
    try {
      const revision = manager.getRun(run)!.revision
      ledger.recordIntent(run, { effectId: 'fx-1', generationId: AgentGenerationId('g-a'), toolCallId: 'call-1',
        effectClass: 'IDEMPOTENT', fingerprint: 'fp', idempotencyKey: 'k-1' }, revision)
      budgets.reserveCall(run, 'budget-1', 'res-1', 5000)
      // Crash between the writes and COMMIT: the whole transaction rolls back.
      const crashed = new EffectLedger(manager)
      expect(() => crashed.recordIntent(run, { effectId: 'fx-2', generationId: AgentGenerationId('g-a'), toolCallId: 'call-2',
        effectClass: 'NEVER_RETRY', fingerprint: 'fp2', idempotencyKey: 'k-2' }, manager.getRun(run)!.revision,
        { beforeCommit: () => { throw new Error('INJECTED_CRASH: process died before COMMIT') } })).toThrow(/INJECTED_CRASH/)
      const state = manager.getState()
      expect(state.effects['fx-2']).toBeUndefined()
      const report = budgets.report('budget-1')
      expect(report.spentMicros).toBe(0)
      expect(report.reservedMicros).toBe(5000)
      // Retry after the crash is safe: the same event id replays idempotently.
      const retry = ledger.recordIntent(run, { effectId: 'fx-1', generationId: AgentGenerationId('g-a'), toolCallId: 'call-1',
        effectClass: 'IDEMPOTENT', fingerprint: 'fp', idempotencyKey: 'k-1' }, revision)
      expect(retry.state).toBe('INTENT')
    } finally { manager.close() }
  })

  it('holds the pure-reducer and journal-append performance floor on this machine', () => {
    const world = seeded()
    const { manager } = world
    try {
      // Pure reducer throughput (no SQLite): 5k-event session-scale journal.
      // Measured scaling (l02-scaling probe, this machine): 1k=136ms, 5k=5.6s, 10k=24.6s,
      // 15k=57s — replay is O(n^2) in journal length (per-event deepFreeze + appliedEvents
      // copy over growing state). Session journals are bounded by compaction checkpoints;
      // the O(n^2) curve is recorded in docs/l02-release-readiness.md as a known limit.
      let state = emptyLifecycleState()
      const journal: LifecycleEvent[] = []
      let seq = 0
      for (let i = 0; i < 5_000; i += 1) {
        seq += 1
        const payload = i === 0
          ? { type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 't', budgetId: 'b', mode: 'DIRECT', branchId: 'root' }
          : i === 1
            ? { type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }
            : i === 2
              ? { type: 'GENERATION_PREPARED', runId: run, agentId: 'agent-lead', generationId: AgentGenerationId('g'), sessionId: 's', route, epoch: 1 }
              : i === 3
                ? { type: 'GENERATION_ACTIVATED', runId: run, agentId: 'agent-lead', generationId: AgentGenerationId('g') }
                : { type: 'GENERATION_CALLBACK', runId: run, generationId: AgentGenerationId('g') }
        journal.push({ schemaVersion: 1, eventId: `perf-${i}`, seq, expectedRevision: i, ...payload } as LifecycleEvent)
      }
      const reduceStart = performance.now()
      for (const entry of journal) state = replayLifecycle([entry], state)
      const reduceMs = performance.now() - reduceStart
      expect(state.seq).toBe(5_000)
      expect(reduceMs).toBeLessThan(10_000)
      // Journal append throughput: 400 appends (each append replays the journal, O(n) per call).
      const appendStart = performance.now()
      for (let i = 0; i < 400; i += 1) {
        manager.append(event({ type: 'GENERATION_CALLBACK', runId: run, generationId: AgentGenerationId('g-a') }, `bench-${i}`),
          manager.getRun(run)!.revision)
      }
      const appendMs = performance.now() - appendStart
      expect(appendMs).toBeLessThan(15_000)
      console.log(`[l02-perf] pure reducer: 5000 events in ${reduceMs.toFixed(0)}ms; journal appends: 400 in ${appendMs.toFixed(0)}ms (${(appendMs / 400).toFixed(2)}ms/append)`)
    } finally { manager.close() }
  }, 30_000)

  it('keeps the source free of dynamic code execution and shell-outs', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : (full.endsWith('.ts') ? [full] : [])
    })
    // Pre-existing host adapters legitimately spawn host CLI processes; new code must not.
    const legacyHostAdapters = (file: string) => file.startsWith('src/host/')
    const forbidden = [/eval\(/, /new Function\(/] as const
    const processTools = [/child_process/, /execSync\(/, /spawnSync\(/] as const
    const violations: string[] = []
    for (const file of walk('src')) {
      const content = readFileSync(file, 'utf8')
      for (const pattern of forbidden) if (pattern.test(content)) violations.push(`${file}: ${String(pattern)}`)
      if (!legacyHostAdapters(file)) {
        for (const pattern of processTools) if (pattern.test(content)) violations.push(`${file}: ${String(pattern)}`)
      }
    }
    expect(violations).toEqual([])
  })
})
