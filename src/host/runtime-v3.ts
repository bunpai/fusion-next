import { createHash, randomUUID } from 'node:crypto'
import type { TaskId } from '../contracts.js'
import type { SqliteFusionStore } from '../task/sqlite-store.js'

/**
 * V3 runtime projection — the only mutable task document the coordinator
 * maintains. Replaces the legacy 'runtime:<taskId>' work-order machine and the
 * reducer-driven TaskState: a pair selection creates the doc once, every
 * fusion_dispatch appends/closes a DispatchRecord, and status/history/UI read
 * this shape directly. Kept deliberately small — the full worker transcript
 * stays in the native child session, this is the audit summary.
 */
export interface DispatchCheck {
  readonly command: string
  readonly exitCode: number
  readonly summary: string
}

export interface DispatchRecord {
  readonly id: string
  readonly instruction: string
  readonly startedAt: string
  endedAt?: string
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'steered' | 'rejected' | 'stalled' | 'quarantined' | 'infra'
  changedFiles?: readonly string[]
  checks?: readonly DispatchCheck[]
  warnings?: readonly string[]
  repairRounds?: number
  error?: string
  /** M0 instrumentation: worker assistant messages during this dispatch. */
  workerSteps?: number
  /** Serialized AuditBundle size the Lead ingested. */
  bundleBytes?: number
  /** Wall time from dispatch begin to finish. */
  wallMs?: number
  /** First failing verify command as `command@exitCode` — escalation-dedup key. */
  failureSignature?: string
  /** M2.1: normalized-instruction sha256 — the identical-resend hard gate key. */
  instructionHash?: string
  /** M2.1 advisory: instruction 2-gram Jaccard >= 0.8 vs the last failed one. */
  resendSuspect?: boolean
  /** M2.3: watchdog break — which limit tripped and what was consumed. */
  stall?: { reason: 'steps' | 'wall'; budgetUsed: { steps: number; wallMs: number } }
  /** M2.3: last observed child tool call at interruption (name + arg head). */
  lastActivity?: string
  /** User-turn epoch (count of user messages in the session) when this
   *  dispatch began — scopes the rework budget to the current user request. */
  epoch?: number
}

export interface RuntimeV3 {
  readonly schemaVersion: 3
  readonly taskId: TaskId
  readonly createdAt: string
  updatedAt: string
  /** Durable worker reservation: the child survives dispatch aborts. */
  worker?: { childId: string }
  dispatches: DispatchRecord[]
  /** Present while the user paused the pair; canRequest denies with this reason. */
  paused?: string
  /** Terminal marker once the binding was cleared. */
  cleared?: string
  /** M2.1: provider-level failures (429/5xx/timeout) — separate from the rework budget. */
  infraAttempts?: number
  /** User-turn epoch the current counters belong to. A new user message opens
   *  a new epoch: the rework budget and infra counter reset so a bad stretch
   *  cannot brick the session for every later request. */
  turnEpoch?: number
}

/** Normalize an instruction for dedup: NFKC -> whitespace collapse -> lowercase ->
 * strip sentence punctuation (CJK/ASCII); keep - _ / . : so a-b.ts != ab.ts. */
export function normalizeInstruction(text: string): string {
  return text.normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[，。！？；、｡「」『』“”‘’"'\uFF01\uFF1F\uFF1B\uFF1A\uFF0C\uFF0E\u3001\u3002]/g, '')
    .trim()
}

export function instructionHash(text: string): string {
  return createHash('sha256').update(normalizeInstruction(text), 'utf8').digest('hex')
}

function charNgrams(text: string, n: number): Set<string> {
  const grams = new Set<string>()
  for (let i = 0; i + n <= text.length; i += 1) grams.add(text.slice(i, i + n))
  return grams
}

/** 2-gram Jaccard over the normalized text — cosmetic-resend advisory signal. */
export function instructionSimilarity(a: string, b: string): number {
  const ga = charNgrams(normalizeInstruction(a), 2)
  const gb = charNgrams(normalizeInstruction(b), 2)
  if (ga.size === 0 || gb.size === 0) return 0
  let inter = 0
  for (const gram of ga) if (gb.has(gram)) inter += 1
  return inter / (ga.size + gb.size - inter)
}

/** Trailing consecutive execution failures inside one user-turn epoch — the
 *  rework-budget consumers. 'rejected' records are transparent (they never
 *  ran); 'stalled'/'quarantined' are watchdog outcomes handled by the repair
 *  path, not worker execution failures; any other status ends the streak.
 *  Records from an older epoch end the streak too. */
export function executionFailures(runtime: RuntimeV3 | undefined, epoch?: number): number {
  const dispatches = runtime?.dispatches ?? []
  let count = 0
  for (let i = dispatches.length - 1; i >= 0; i--) {
    const record = dispatches[i]
    if (record.status === 'rejected') continue
    if (record.status !== 'failed') break
    if (epoch !== undefined && (record.epoch ?? epoch) !== epoch) break
    count++
  }
  return count
}

/** The most recent execution-failure record — dedup/similarity comparator. */
export function lastFailedDispatch(runtime: RuntimeV3 | undefined): DispatchRecord | undefined {
  return runtime?.dispatches.findLast(record => record.status === 'failed' || record.status === 'stalled' || record.status === 'quarantined')
}

const docId = (taskId: TaskId): string => `runtime:${taskId}`

export function readRuntime(store: SqliteFusionStore, taskId: TaskId): RuntimeV3 | undefined {
  const row = store.readDocument(docId(taskId))
  if (!row) return undefined
  const value = row.value as RuntimeV3 | undefined
  return value && value.schemaVersion === 3 && value.taskId === taskId ? value : undefined
}

export function createRuntime(store: SqliteFusionStore, taskId: TaskId): RuntimeV3 {
  const now = new Date().toISOString()
  const runtime: RuntimeV3 = { schemaVersion: 3, taskId, createdAt: now, updatedAt: now, dispatches: [] }
  store.writeDocument(docId(taskId), 0, runtime)
  return runtime
}

/** Read-modify-write with CAS retry; the only writer is this coordinator. */
export function updateRuntime(store: SqliteFusionStore, taskId: TaskId, mutate: (runtime: RuntimeV3) => void): RuntimeV3 {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = store.readDocument(docId(taskId))
    if (!row) throw new Error(`Fusion runtime doc missing for ${taskId}`)
    const runtime = structuredClone(row.value) as RuntimeV3
    mutate(runtime)
    runtime.updatedAt = new Date().toISOString()
    try {
      store.writeDocument(docId(taskId), row.revision, runtime)
      return runtime
    } catch { /* another writer won the race — reread and reapply */ }
  }
  throw new Error(`Fusion runtime update kept racing for ${taskId}`)
}

/** A dispatch the Lead tool call is still settled on (or lost to steering). */
export function liveDispatch(runtime: RuntimeV3 | undefined): DispatchRecord | undefined {
  return runtime?.dispatches.findLast(record => record.status === 'running')
}

export function beginDispatch(store: SqliteFusionStore, taskId: TaskId, instruction: string, extra?: Partial<DispatchRecord>): DispatchRecord {
  const record: DispatchRecord = { id: `dispatch-${randomUUID()}`, instruction, startedAt: new Date().toISOString(), status: 'running', ...extra }
  updateRuntime(store, taskId, runtime => {
    const live = liveDispatch(runtime)
    if (live) live.status = 'interrupted'
    runtime.dispatches.push(record)
    if (runtime.dispatches.length > 40) runtime.dispatches.splice(0, runtime.dispatches.length - 40)
  })
  return record
}

export function finishDispatch(store: SqliteFusionStore, taskId: TaskId, id: string, patch: Partial<DispatchRecord>): void {
  updateRuntime(store, taskId, runtime => {
    const record = runtime.dispatches.find(item => item.id === id)
    if (!record) return
    Object.assign(record, patch)
    if (record.status === 'running') record.status = 'completed'
    record.endedAt = record.endedAt ?? new Date().toISOString()
  })
}
