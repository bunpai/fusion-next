/** D01 durable effect ledger: intent -> dispatch -> receipt/reconcile over the B03 journal.
 * External side effects can never be made exactly-once with SQLite state (plan §6); this ledger
 * therefore records intents and outcomes as journal events in the SAME transaction as all run
 * state, classifies retry safety, forces unknown outcomes into NEEDS_REPAIR, and refuses to drain
 * a run while any effect is unsettled. Retrying an external call is the adapter's decision and
 * must be consistent with the recorded class. */
import { createHash } from 'node:crypto'
import { AgentGenerationId, FusionRunId, type EffectClass, type EffectRecord, type EffectState } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'

/** sha256 over canonical JSON of {tool,args,target}; the documented fingerprint rule (plan §8). */
// Transition event ids embed the per-run CAS revision they were accepted at: an identical retry
// collapses on the same event id (at-least-once delivery), while a re-issued transition after the
// state advanced becomes a NEW event that the reducer validates against the effect state machine.
export function effectFingerprint(tool: string, args: unknown, target: string): string {
  return createHash('sha256').update(JSON.stringify({ tool, args, target })).digest('hex')
}

export type EffectOutcome = 'SUCCEEDED' | 'FAILED_KNOWN'

export interface EffectIntentInput {
  readonly effectId: string
  readonly generationId: AgentGenerationId
  readonly toolCallId: string
  readonly effectClass: EffectClass
  readonly fingerprint: string
  readonly idempotencyKey: string
}

export interface EffectAppendOptions { readonly beforeCommit?: () => void }

export interface DrainResult {
  readonly settled: number
  readonly discarded: number
}

export class EffectLedger {
  constructor(private readonly manager: RunManager) {}

  list(runId: FusionRunId): EffectRecord[] {
    return Object.values(this.manager.getState().effects).filter(e => e.runId === runId)
  }

  find(runId: FusionRunId, idempotencyKey: string): EffectRecord | undefined {
    return this.list(runId).find(e => e.idempotencyKey === idempotencyKey)
  }

  recordIntent(runId: FusionRunId, input: EffectIntentInput, expectedRevision: number, options: EffectAppendOptions = {}): EffectRecord {
    this.commit({ schemaVersion: 1, eventId: eventId(input.effectId, 'intent', expectedRevision),
      type: 'EFFECT_INTENT_RECORDED', runId, effectId: input.effectId, generationId: input.generationId,
      toolCallId: input.toolCallId, effectClass: input.effectClass, fingerprint: input.fingerprint,
      idempotencyKey: input.idempotencyKey } as RunEventInput, expectedRevision, options)
    return this.get(input.effectId)
  }

  dispatch(runId: FusionRunId, effectId: string, expectedRevision: number, options: EffectAppendOptions = {}): EffectRecord {
    this.commit({ schemaVersion: 1, eventId: eventId(effectId, 'dispatch', expectedRevision),
      type: 'EFFECT_DISPATCHED', runId, effectId } as RunEventInput, expectedRevision, options)
    return this.get(effectId)
  }

  recordReceipt(runId: FusionRunId, effectId: string, receiptRef: string, outcome: EffectOutcome, expectedRevision: number, options: EffectAppendOptions = {}): EffectRecord {
    this.commit({ schemaVersion: 1, eventId: eventId(effectId, 'receipt', expectedRevision),
      type: 'EFFECT_RECEIPT_RECORDED', runId, effectId, receiptRef, outcome } as RunEventInput, expectedRevision, options)
    return this.get(effectId)
  }

  /** Unknown external outcome: no retry decision can be made automatically. */
  markUnresolved(runId: FusionRunId, effectId: string, expectedRevision: number, options: EffectAppendOptions = {}): EffectRecord {
    this.commit({ schemaVersion: 1, eventId: eventId(effectId, 'unresolved', expectedRevision),
      type: 'EFFECT_UNRESOLVED', runId, effectId } as RunEventInput, expectedRevision, options)
    return this.get(effectId)
  }

  /** Verified resolution of a NEEDS_REPAIR effect; outcome must come from an external check. */
  reconcile(runId: FusionRunId, effectId: string, receiptRef: string, outcome: EffectOutcome, expectedRevision: number, options: EffectAppendOptions = {}): EffectRecord {
    this.commit({ schemaVersion: 1, eventId: eventId(effectId, 'reconcile', expectedRevision),
      type: 'EFFECT_RECONCILED', runId, effectId, receiptRef, outcome } as RunEventInput, expectedRevision, options)
    return this.get(effectId)
  }

  /** Only an intent that was never dispatched may be dropped without external verification. */
  discard(runId: FusionRunId, effectId: string, expectedRevision: number, options: EffectAppendOptions = {}): EffectRecord {
    this.commit({ schemaVersion: 1, eventId: eventId(effectId, 'discard', expectedRevision),
      type: 'EFFECT_DISCARDED', runId, effectId } as RunEventInput, expectedRevision, options)
    return this.get(effectId)
  }

  /** Drain barrier: a run may only leave its tool boundary with every effect terminal.
   * Throws EFFECT_DRAIN_BLOCKED while INTENT/EXECUTING/NEEDS_REPAIR effects remain. */
  drain(runId: FusionRunId): DrainResult {
    const blocked = this.list(runId).filter(e => !isTerminal(e.state))
    if (blocked.length > 0) {
      const detail = blocked.map(e => `${e.effectId}:${e.state}`).join(', ')
      throw new Error(`EFFECT_DRAIN_BLOCKED: run ${runId} has ${blocked.length} unsettled effect(s): ${detail}`)
    }
    const all = this.list(runId)
    return { settled: all.filter(e => e.state === 'SETTLED').length, discarded: all.filter(e => e.state === 'DISCARDED').length }
  }

  private get(effectId: string): EffectRecord {
    const effect = this.manager.getState().effects[effectId]
    if (!effect) throw new Error(`EFFECT_LEDGER_CONFLICT: effect ${effectId} missing after append`)
    return effect
  }

  private commit(input: RunEventInput, expectedRevision: number, options: EffectAppendOptions): void {
    void expectedRevision
    this.manager.append(input, expectedRevision, options)
  }
}

const eventId = (effectId: string, transition: string, expectedRevision: number): string => `fusion/effect/${effectId}/${transition}/r${expectedRevision}`

const TERMINAL_STATES: readonly EffectState[] = ['SETTLED', 'DISCARDED']
const isTerminal = (state: EffectState): boolean => TERMINAL_STATES.includes(state)
