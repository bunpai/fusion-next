import type { SqliteFusionStore } from '../task/sqlite-store.js'
import type { StatusIndex } from '../task/status-index.js'
import type { FusionStatus } from '../status.js'
import { BindingRepository } from './bindings.js'
import { readRuntime, liveDispatch, type RuntimeV3, type DispatchRecord } from './runtime-v3.js'

/** English copies of the stage and detail texts; the client shows them when DSH runs in English. */
const EN: Record<string, string> = {
  '就绪': 'Ready', '执行': 'Working', '审查': 'Reviewing', '完成': 'Done',
  '已暂停': 'Paused', '未完成': 'Unfinished', '等待检查': 'Needs inspection',
  '使用 /fusion-next status 查看状态，确认后可用 /fusion-next resume 继续。': 'Check /fusion-next status, then continue with /fusion-next resume.',
  '上次派发被中断 — 再次调用 fusion_dispatch 可继续收集结果。': 'The last dispatch was interrupted — call fusion_dispatch again to collect it.',
  'Worker 仍在后台运行 — 调用 fusion_dispatch（不带 instruction）收集结果。': 'The worker is still running — call fusion_dispatch (without instruction) to collect it.',
}
const english = (text: string | null | undefined) => (text == null ? text : EN[text] ?? text)

/** Stage projection off the v3 runtime doc — no task reducer involved. */
export function runtimeStage(runtime: RuntimeV3 | undefined): Pick<NonNullable<FusionStatus['task']>, 'stage' | 'detail' | 'attention'> {
  const value = (stage: string, detail: string | null = null, attention = false) => ({ stage, detail, attention })
  if (!runtime) return value('就绪')
  if (runtime.cleared) return value('完成')
  if (runtime.paused) return value('已暂停', '使用 /fusion-next status 查看状态，确认后可用 /fusion-next resume 继续。', true)
  if (liveDispatch(runtime)) return value('执行')
  const last: DispatchRecord | undefined = runtime.dispatches[runtime.dispatches.length - 1]
  if (!last) return value('就绪')
  if (last.status === 'completed') {
    return last.warnings?.length
      ? value('审查', '静态审计有警告：' + last.warnings[0], true)
      : value('完成')
  }
  if (last.status === 'interrupted') return value('等待检查', '上次派发被中断 — 再次调用 fusion_dispatch 可继续收集结果。', true)
  if (last.status === 'steered') return value('执行', 'Worker 仍在后台运行 — 调用 fusion_dispatch（不带 instruction）收集结果。')
  return value('未完成', last.error ?? '验证未通过，请查看会话中的审计结果。', true)
}

const verificationOf = (last: DispatchRecord | undefined): FusionStatus['task'] extends undefined ? never : NonNullable<FusionStatus['task']>['verification'] => {
  const checks = last?.checks ?? []
  if (!last || checks.length === 0) return 'unverified'
  const failed = checks.filter(check => check.exitCode !== 0).length
  return failed === 0 ? 'verified' : failed === checks.length ? 'unverified' : 'partial'
}

/** Reads existing durable facts only. Polling never constructs a runtime or calls a model. */
export function readFusionStatus(store: SqliteFusionStore, sessionId: string): FusionStatus {
  return store.statusSnapshot(index => readStatus(store, sessionId, index))
}

export function readFusionStatusAsync(store: SqliteFusionStore, sessionId: string, signal?: AbortSignal): Promise<FusionStatus> {
  return store.statusSnapshotAsync(index => readStatus(store, sessionId, index), signal)
}

function readStatus(store: SqliteFusionStore, sessionId: string, index: StatusIndex): FusionStatus {
  const binding = new BindingRepository(store).read(sessionId)?.binding
  const base: FusionStatus = { schemaVersion: 1, sessionId, selected: Boolean(binding?.selected), observedAt: new Date().toISOString() }
  if (!binding?.selected) return base
  const taskId = binding.taskId
  const row = store.readDocument('runtime:' + taskId)
  const runtime = readRuntime(store, taskId)
  const { checking, ...facts } = index.read(taskId)
  const stage = runtimeStage(runtime)
  const last = runtime?.dispatches[runtime.dispatches.length - 1]
  return {
    ...base,
    task: {
      id: taskId,
      revision: row?.revision ?? 0,
      ...stage,
      stageEn: english(stage.stage)!,
      detailEn: english(stage.detail) ?? null,
      verification: verificationOf(last),
      workerId: runtime?.worker?.childId ?? binding.workerId ?? null,
      models: { lead: binding.profile.lead, worker: binding.profile.worker, compactor: binding.profile.compactor?.route ?? null },
      ...facts,
      automatedChecks: last ? (last.checks?.length ?? 0) : null,
      pendingApprovals: 0,
      recovering: Boolean(runtime?.paused),
      outcomeUnknown: last?.status === 'interrupted',
    },
  }
}
