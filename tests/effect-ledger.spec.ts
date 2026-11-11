import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2, openFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type EffectClass, type LifecycleEvent } from '../src/lifecycle/index.js'
import { EffectLedger, effectFingerprint } from '../src/effects/ledger.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-d01-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const generation = AgentGenerationId('gen-1')
const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>

function seeded(): { file: string; manager: RunManager; ledger: EffectLedger } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  manager.append(event({ type: 'GENERATION_PREPARED', runId: run, generationId: generation, agentId: 'agent-1', sessionId: 'native-1',
    route: { provider: 'test', model: 'm1', capabilityDigest: 'digest' }, epoch: 1 }, 'seed-generation'), 2)
  manager.append(event({ type: 'GENERATION_ACTIVATED', runId: run, generationId: generation }, 'seed-generation-active'), 3)
  return { file, manager, ledger: new EffectLedger(manager) }
}

const intent = (effectId: string, effectClass: EffectClass = 'IDEMPOTENT', idempotencyKey = `key-${effectId}`) =>
  ({ effectId, generationId: generation, toolCallId: 'call-1', effectClass, fingerprint: effectFingerprint('shell', { cmd: 'ls' }, '/w'), idempotencyKey }) as const
// Per-run CAS revision advances with EVERY append (effect transitions included).
const rev = (m: RunManager) => m.getState().runs[run].revision

describe('D01 durable effect ledger', () => {
  it('records intent, dispatch and receipt with journal-derived state and SQL projection', () => {
    const { file, manager, ledger } = seeded()
    try {
      ledger.recordIntent(run, intent('fx-1'), rev(manager))
      expect(manager.getState().effects['fx-1']).toMatchObject({ state: 'INTENT', effectClass: 'IDEMPOTENT' })
      ledger.dispatch(run, 'fx-1', rev(manager))
      ledger.recordReceipt(run, 'fx-1', 'receipt://1', 'SUCCEEDED', rev(manager))
      const record = manager.getState().effects['fx-1']
      expect(record.state).toBe('SETTLED')
      expect(record.receiptRef).toBe('receipt://1')
      expect(record.outcome).toBe('SUCCEEDED')
      expect(record.resolvedBy).toBe('receipt')
      const raw = openFusionV2(file).prepare('SELECT state, receipt_ref FROM fusion_effects WHERE effect_id = ?').get('fx-1') as { state: string; receipt_ref: string | null }
      expect(raw.state).toBe('SETTLED')
      expect(raw.receipt_ref).toBe('receipt://1')
      expect(ledger.drain(run)).toEqual({ settled: 1, discarded: 0 })
    } finally { manager.close() }
  })

  it('rejects duplicate idempotency keys, unknown classes and foreign generations', () => {
    const { manager, ledger } = seeded()
    try {
      ledger.recordIntent(run, intent('fx-a'), rev(manager))
      expect(() => ledger.recordIntent(run, intent('fx-b', 'IDEMPOTENT', 'key-fx-a'), rev(manager))).toThrow(/idempotency key already exists/)
      expect(() => ledger.recordIntent(run, intent('fx-c', 'MAYBE' as EffectClass), rev(manager))).toThrow(/unknown effect class/)
      expect(() => ledger.recordIntent(run, { ...intent('fx-d'), generationId: AgentGenerationId('nope') }, rev(manager))).toThrow(/generation ownership mismatch/)
    } finally { manager.close() }
  })

  it('forces unknown outcomes into NEEDS_REPAIR, blocks drain, and settles only via reconcile', () => {
    const { manager, ledger } = seeded()
    try {
      ledger.recordIntent(run, intent('fx-u', 'NEEDS_VERIFICATION'), rev(manager))
      ledger.dispatch(run, 'fx-u', rev(manager))
      ledger.markUnresolved(run, 'fx-u', rev(manager))
      expect(manager.getState().effects['fx-u'].state).toBe('NEEDS_REPAIR')
      expect(() => ledger.drain(run)).toThrow(/EFFECT_DRAIN_BLOCKED.*fx-u:NEEDS_REPAIR/)
      expect(() => ledger.recordReceipt(run, 'fx-u', 'r', 'SUCCEEDED', rev(manager))).toThrow(/illegal effect receipt/)
      ledger.reconcile(run, 'fx-u', 'receipt://manual', 'FAILED_KNOWN', rev(manager))
      const record = manager.getState().effects['fx-u']
      expect(record.state).toBe('SETTLED')
      expect(record.resolvedBy).toBe('reconcile')
      expect(ledger.drain(run)).toEqual({ settled: 1, discarded: 0 })
    } finally { manager.close() }
  })

  it('enforces class-based re-dispatch rules and terminal-state fencing', () => {
    const { manager, ledger } = seeded()
    try {
      ledger.recordIntent(run, intent('fx-v', 'NEEDS_VERIFICATION'), rev(manager))
      ledger.dispatch(run, 'fx-v', rev(manager))
      expect(() => ledger.dispatch(run, 'fx-v', rev(manager))).toThrow(/illegal effect dispatch/)
      ledger.recordIntent(run, intent('fx-i', 'IDEMPOTENT', 'key-i'), rev(manager))
      ledger.dispatch(run, 'fx-i', rev(manager))
      ledger.dispatch(run, 'fx-i', rev(manager))
      expect(manager.getState().effects['fx-i'].state).toBe('EXECUTING')
      ledger.recordReceipt(run, 'fx-i', 'r', 'SUCCEEDED', rev(manager))
      expect(() => ledger.dispatch(run, 'fx-i', rev(manager))).toThrow(/illegal effect dispatch/)
      ledger.recordIntent(run, intent('fx-n', 'NEVER_RETRY', 'key-n'), rev(manager))
      ledger.dispatch(run, 'fx-n', rev(manager))
      ledger.recordReceipt(run, 'fx-n', 'r', 'FAILED_KNOWN', rev(manager))
      expect(() => ledger.dispatch(run, 'fx-n', rev(manager))).toThrow(/illegal effect dispatch/)
    } finally { manager.close() }
  })

  it('rolls back cleanly on crash before commit and keeps CAS revision unchanged', () => {
    const { manager, ledger } = seeded()
    try {
      expect(() => ledger.recordIntent(run, intent('fx-crash'), rev(manager), { beforeCommit: () => { throw new Error('boom') } })).toThrow(/boom/)
      expect(Object.keys(manager.getState().effects)).toEqual([])
      expect(manager.listEvents(run)).toHaveLength(4)
      ledger.recordIntent(run, intent('fx-crash'), rev(manager))
      expect(manager.getState().effects['fx-crash'].state).toBe('INTENT')
    } finally { manager.close() }
  })

  it('recovers committed effect state after restart and collapses identical retries idempotently', () => {
    const { file, manager, ledger } = seeded()
    try {
      ledger.recordIntent(run, intent('fx-r'), rev(manager))
      ledger.dispatch(run, 'fx-r', rev(manager))
    } finally { manager.close() }
    const reopened = openRunManager(file)
    try {
      const recovered = new EffectLedger(reopened)
      expect(reopened.getState().effects['fx-r'].state).toBe('EXECUTING')
      const r = rev(reopened)
      recovered.recordReceipt(run, 'fx-r', 'receipt://2', 'SUCCEEDED', r)
      recovered.recordReceipt(run, 'fx-r', 'receipt://2', 'SUCCEEDED', r)
      expect(reopened.getState().effects['fx-r']).toMatchObject({ state: 'SETTLED', receiptRef: 'receipt://2' })
      // 4 seed events + intent + dispatch + one receipt; the identical retry collapsed.
      expect(reopened.listEvents(run)).toHaveLength(7)
    } finally { reopened.close() }
  })

  it('conflicts when the same transition is replayed with different contents', () => {
    const { manager, ledger } = seeded()
    try {
      ledger.recordIntent(run, intent('fx-x'), rev(manager))
      ledger.dispatch(run, 'fx-x', rev(manager))
      const r = rev(manager)
      expect(() => ledger.recordReceipt(run, 'fx-x', 'receipt://a', 'SUCCEEDED', r)).not.toThrow()
      expect(() => ledger.recordReceipt(run, 'fx-x', 'receipt://a', 'FAILED_KNOWN', r)).toThrow(/event id reused with different contents/)
    } finally { manager.close() }
  })

  it('drains only terminal effects and allows discarding undispatched intents', () => {
    const { manager, ledger } = seeded()
    try {
      ledger.recordIntent(run, intent('fx-s1', 'IDEMPOTENT', 'k1'), rev(manager))
      ledger.dispatch(run, 'fx-s1', rev(manager))
      ledger.recordReceipt(run, 'fx-s1', 'r', 'SUCCEEDED', rev(manager))
      ledger.recordIntent(run, intent('fx-s2', 'IDEMPOTENT', 'k2'), rev(manager))
      expect(() => ledger.drain(run)).toThrow(/EFFECT_DRAIN_BLOCKED.*fx-s2:INTENT/)
      ledger.discard(run, 'fx-s2', rev(manager))
      expect(() => ledger.discard(run, 'fx-s1', rev(manager))).toThrow(/only undispatched intents/)
      expect(ledger.drain(run)).toEqual({ settled: 1, discarded: 1 })
      expect(manager.foreignKeyViolations()).toEqual([])
    } finally { manager.close() }
  })
})
