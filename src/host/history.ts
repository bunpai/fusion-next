import type { SqliteFusionStore } from '../task/sqlite-store.js'
import type { TaskState } from '../task/state.js'
import type { NativeUsageRecord } from './native-usage.js'
import { projectLedger, restoreLedger, type Count } from '../usage/ledger.js'

export interface TaskSummary {
  id: string; sessionId: string; seq: number; createdAt: string; updatedAt: string
  title: string; phase: string; verification: string; mode: string
}
export function taskSummary(state: TaskState, createdAt: string, updatedAt: string): TaskSummary {
  return { id: state.taskId, sessionId: state.parent, seq: state.seq, createdAt, updatedAt,
    title: state.currentWorkOrder?.goal?.slice(0, 160) || '对话任务', phase: state.phase, verification: state.verification, mode: state.control.mode }
}
export interface UsageSummary {
  id: string; taskId: string; role: string; provider: string; model: string; purpose: string; startedAt: string
  outcome: string; authority: 'none' | 'provisional' | 'final'; input: Count; output: Count; cacheRead: Count
}
export function usageSummary(row: NativeUsageRecord): UsageSummary {
  const projection = projectLedger(restoreLedger(row.ledger))
  return { id: row.nativeInvocationId, taskId: row.taskId, role: row.role, provider: row.ledger.key.provider, model: row.ledger.key.model,
    purpose: row.purpose ?? 'conversation', startedAt: row.startedAt, outcome: row.outcome, authority: projection.authority,
    input: projection.bill?.uncachedInput ?? { state: 'unknown' }, output: projection.bill?.output ?? { state: 'unknown' },
    cacheRead: projection.bill?.cacheRead ?? { state: 'unknown' } }
}

/** Once at plugin startup; GET never writes, starts agents, or scans full task/usage snapshots. */
export function backfillHistory(store: SqliteFusionStore) {
  for (const id of store.listTaskIds()) {
    if (store.readDocument(`task-index:${id}`)) continue
    const state = store.load(id)!, events = store.events(id)
    store.writeDocument(`task-index:${id}`, 0, taskSummary(state, events[0]!.createdAt, events.at(-1)!.createdAt))
  }
  for (const id of store.listDocumentIds('usage:')) {
    const projectionId = `usage-index:${id.slice(6)}`
    if (store.readDocument(projectionId)) continue
    store.writeDocument(projectionId, 0, usageSummary(store.readDocument(id)!.value as NativeUsageRecord))
  }
}
export interface HistoryTotals { calls: number; final: number; provisional: number; unreported: number;
  input: { known: number; reported: number }; output: { known: number; reported: number }; cacheRead: { known: number; reported: number } }
const empty = (): HistoryTotals => ({ calls: 0, final: 0, provisional: 0, unreported: 0,
  input: { known: 0, reported: 0 }, output: { known: 0, reported: 0 }, cacheRead: { known: 0, reported: 0 } })
function add(total: HistoryTotals, row: UsageSummary) {
  total.calls++; total[row.authority === 'none' ? 'unreported' : row.authority]++
  for (const key of ['input', 'output', 'cacheRead'] as const) {
    const count = row[key]
    if (count.state === 'known') { total[key].known += count.tokens; total[key].reported++ }
  }
}
/** How often the Host unlocked Lead takeover (enforced-v3), by reason. */
export interface TakeoverTotals { total: number; tasks: number; reasons: Record<string, number> }
export interface HistoryView {
  observedAt: string; totalTasks: number; tasks: (TaskSummary & { usage: HistoryTotals; takeovers: number })[]; nextCursor: string | null
  takeovers: TakeoverTotals
  totals: HistoryTotals; groups: ({ role: string; provider: string; model: string; purpose: string } & HistoryTotals)[]
  actualBilledUsd: null; savingsPercent: null; upstreamHttpCalls: null
}
/** Per-task scorecard (homerail scorecard borrow): one card per task showing the
 *  pair, per-role token spend, rework rounds and check outcomes — the data a
 *  planner-vs-executor cost decision actually needs. */
export interface ScorecardEntry {
  taskId: string; sessionId: string; title: string; phase: string; verification: string; mode: string
  createdAt: string; updatedAt: string; wallMs: number
  lead: { provider: string; model: string } | null; worker: { provider: string; model: string } | null
  leadIn: number; leadOut: number; workerIn: number; workerOut: number; cacheRead: number
  reworkRounds: number; submitted: string | null; checks: { total: number; passed: number }
}
export function readScorecard(store: SqliteFusionStore, limit = 50): { observedAt: string; totalTasks: number; cards: ScorecardEntry[] } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Scorecard limit must be 1–200')
  const tasks = store.listDocumentIds('task-index:').map(id => store.readDocument(id)!.value as TaskSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit)
  const usage = new Map<string, { leadIn: number; leadOut: number; workerIn: number; workerOut: number; cacheRead: number }>()
  for (const id of store.listDocumentIds('usage-index:')) {
    const row = store.readDocument(id)!.value as UsageSummary
    const u = usage.get(row.taskId) ?? { leadIn: 0, leadOut: 0, workerIn: 0, workerOut: 0, cacheRead: 0 }
    const tok = (c: { state: string; tokens?: number } | undefined) => c?.state === 'known' ? c.tokens ?? 0 : 0
    const role = row.role === 'worker' ? 'worker' : 'lead'
    u[`${role}In` as 'leadIn' | 'workerIn'] += tok(row.input)
    u[`${role}Out` as 'leadOut' | 'workerOut'] += tok(row.output)
    u.cacheRead += tok(row.cacheRead)
    usage.set(row.taskId, u)
  }
  const cards = tasks.map(task => {
    const binding = store.readDocument(`binding:${task.sessionId}`)?.value as
      { profile?: { lead?: { provider: string; model: string }; worker?: { provider: string; model: string } } } | undefined
    const runtime = store.readDocument(`runtime:${task.id}`)?.value as
      { reworkRounds?: number; submitted?: { status?: string }; checks?: readonly unknown[] } | undefined
    let passed = 0
    const checkIds = store.listDocumentIds(`check-invocation:${task.id}:`)
    for (const id of checkIds) {
      const inv = store.readDocument(id)!.value as { evidence?: { state?: string; exitCode?: number | null } }
      if (inv.evidence?.state === 'completed' && inv.evidence.exitCode === 0) passed++
    }
    const u = usage.get(task.id) ?? { leadIn: 0, leadOut: 0, workerIn: 0, workerOut: 0, cacheRead: 0 }
    const route = (r?: { provider: string; model: string }) => r ? { provider: r.provider, model: r.model } : null
    return { taskId: task.id, sessionId: task.sessionId, title: task.title, phase: task.phase,
      verification: task.verification, mode: task.mode, createdAt: task.createdAt, updatedAt: task.updatedAt,
      wallMs: Math.max(0, Date.parse(task.updatedAt) - Date.parse(task.createdAt)),
      lead: route(binding?.profile?.lead), worker: route(binding?.profile?.worker), ...u,
      reworkRounds: runtime?.reworkRounds ?? 0, submitted: runtime?.submitted?.status ?? null,
      checks: { total: (runtime?.checks ?? []).length || checkIds.length, passed } }
  })
  return { observedAt: new Date().toISOString(), totalTasks: store.listDocumentIds('task-index:').length, cards }
}

export function readHistory(store: SqliteFusionStore, cursor = '', limit = 20): HistoryView {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('History page size must be 1–50')
  const tasks = store.listDocumentIds('task-index:').map(id => store.readDocument(id)!.value as TaskSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const all = store.listDocumentIds('usage-index:').map(id => store.readDocument(id)!.value as UsageSummary)
  const groups = new Map<string, HistoryView['groups'][number]>(), byTask = new Map<string, HistoryTotals>(), totals = empty()
  for (const row of all) {
    add(totals, row)
    const own = byTask.get(row.taskId) ?? empty(); add(own, row); byTask.set(row.taskId, own)
    const key = JSON.stringify([row.role, row.provider, row.model, row.purpose])
    const group = groups.get(key) ?? { role: row.role, provider: row.provider, model: row.model, purpose: row.purpose, ...empty() }
    add(group, row); groups.set(key, group)
  }
  const takeovers: TakeoverTotals = { total: 0, tasks: 0, reasons: {} }, takeoversByTask = new Map<string, number>()
  for (const id of store.listDocumentIds('lead-takeover:')) {
    const row = store.readDocument(id)!.value as { taskId: string; reason: string }
    takeovers.total++; takeovers.reasons[row.reason] = (takeovers.reasons[row.reason] ?? 0) + 1
    takeoversByTask.set(row.taskId, (takeoversByTask.get(row.taskId) ?? 0) + 1)
  }
  takeovers.tasks = takeoversByTask.size
  const start = cursor ? tasks.findIndex(task => task.id === cursor) + 1 : 0
  if (cursor && start === 0) throw new Error('History cursor is no longer available')
  const page = tasks.slice(start, start + limit)
  return { observedAt: new Date().toISOString(), totalTasks: tasks.length,
    tasks: page.map(task => ({ ...task, usage: byTask.get(task.id) ?? empty(), takeovers: takeoversByTask.get(task.id) ?? 0 })),
    nextCursor: start + limit < tasks.length ? page.at(-1)!.id : null, takeovers,
    totals, groups: [...groups.values()].sort((a, b) => b.calls - a.calls), actualBilledUsd: null, savingsPercent: null, upstreamHttpCalls: null }
}
