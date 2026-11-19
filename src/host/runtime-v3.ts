import { randomUUID } from 'node:crypto'
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
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'steered'
  changedFiles?: readonly string[]
  checks?: readonly DispatchCheck[]
  warnings?: readonly string[]
  repairRounds?: number
  error?: string
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

export function beginDispatch(store: SqliteFusionStore, taskId: TaskId, instruction: string): DispatchRecord {
  const record: DispatchRecord = { id: `dispatch-${randomUUID()}`, instruction, startedAt: new Date().toISOString(), status: 'running' }
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
