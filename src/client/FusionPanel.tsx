import { useEffect, useState } from 'react'
import { tr, useLang, type Lang } from './i18n.js'
import type { PhysicalRoute } from '../contracts.js'
import { FusionHistory } from './FusionHistory.js'
import { FusionCache } from './FusionCache.js'

interface RunningTask {
  id: string
  revision: number
  stage: string
  stageEn?: string
  detail?: string | null
  detailEn?: string | null
  attention?: boolean
  usage?: { calls: number }
}
interface RunningSession {
  sessionId: string
  title: string | null
  lead: PhysicalRoute
  worker: PhysicalRoute
  task: RunningTask | null
}

const styles = `
.fusion-panel{padding:24px 28px;max-width:920px;overflow:auto;height:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
.fusion-panel h1{font-size:20px;margin:0 0 6px;font-weight:600;letter-spacing:-0.01em}
.fusion-panel>p{margin:0 0 20px;color:var(--dsw-alias-label-secondary);max-width:640px}
.fusion-panel .fusion-history,.fusion-panel .fusion-cache{margin:0 0 28px}
.fusion-panel table{border-collapse:collapse;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.fusion-panel :is(th,td){text-align:left;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);font-weight:400;vertical-align:top}
.fusion-panel tbody tr:last-child td{border-bottom:0}
.fusion-panel tbody tr{transition:background-color .12s}
.fusion-panel tbody tr:hover{background-color:var(--dsw-alias-bg-layer-1)}
.fusion-panel thead th{color:var(--dsw-alias-label-secondary);font-weight:600;font-size:12px;background-color:var(--dsw-alias-bg-layer-1);white-space:nowrap}
.fusion-panel small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
.fusion-panel button{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 14px;background-color:var(--dsw-alias-button-elevated-fill);cursor:pointer;transition:background-color .12s,border-color .12s}
.fusion-panel button:hover:not(:disabled){background-color:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1))}
.fusion-panel button:disabled{opacity:.5;cursor:default}
.fusion-panel .fusion-actions{display:flex;gap:8px;margin:8px 0}
.fusion-panel h2{font-size:14px;margin:0 0 8px;font-weight:600}
.fusion-panel h3{font-size:13px;margin:14px 0 6px;font-weight:600}
.fusion-panel ol,.fusion-panel ul{margin:0;padding-left:20px}
.fusion-panel li{margin:0 0 10px}
.fusion-panel [role=alert]{color:var(--dsw-alias-state-error-primary)}
.fusion-panel select,.fusion-panel input{font:inherit;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;color-scheme:inherit}
.fusion-panel .fusion-empty{padding:48px 16px;text-align:center;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;font-size:13px}
.fusion-panel .fusion-running{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px}
.fusion-panel .fusion-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.3}
.fusion-panel .fusion-chip b{font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fusion-panel .fusion-chip[data-attention=true]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.fusion-panel .fusion-chip .fusion-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none}
.fusion-panel .fusion-chip[data-stage=完成] .fusion-dot{background:var(--dsw-alias-state-success-primary,#3a5)}
.fusion-panel .fusion-chip[data-stage=待命] .fusion-dot{background:var(--dsw-alias-label-secondary);opacity:.5}
.fusion-panel .fusion-tabs{display:flex;gap:2px;margin:0 0 20px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.fusion-panel .fusion-tabs button{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:none;border:0;border-bottom:2px solid transparent;padding:7px 14px;cursor:pointer;border-radius:0;transition:color .12s}
.fusion-panel .fusion-tabs button:hover{color:var(--dsw-alias-label-primary)}
.fusion-panel .fusion-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
`

const FINISHED = new Set(['完成'])
const stageOf = (lang: Lang, task: RunningTask | null) =>
  task ? (lang === 'en' ? task.stageEn ?? task.stage : task.stage) : tr(lang, '待命', 'idle')

/** Sidebar rail glyph: two linked nodes, the planner-executor pair. */
export function FusionNextIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12.5" cy="12.5" r="3" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7.8 7.8 10.2 10.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
}

/**
 * Global console behind the sidebar icon. A persistent strip lists every
 * session running a fusion pair (session label + stage); tabs below cover the
 * live session table, run history, and the cache-keepalive ledger.
 */
export function FusionPanel() {
  const lang = useLang()
  const [tab, setTab] = useState<'running' | 'history' | 'cache'>('running')
  const [sessions, setSessions] = useState<RunningSession[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    const load = () => {
      void fetch('/api/fusion-next?view=running', { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
        .then(async response => {
          if (!response.ok) throw new Error('unavailable')
          const view = await response.json() as { sessions: RunningSession[] }
          setSessions(view.sessions ?? []); setLoaded(true)
        })
        .catch(() => { if (!abort.signal.aborted) setLoaded(true) })
    }
    load()
    const timer = setInterval(load, 10000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [])
  const running = sessions.filter(session => session.task && !FINISHED.has(session.task.stage))
  const labelOf = (session: RunningSession) =>
    session.title ?? session.sessionId.replace(/^session-/, '').split('-')[0]
  return <main className="fusion-panel" aria-label={tr(lang, 'Fusion Next 控制台', 'Fusion Next console')} data-ud-check="fusion-panel">
    <style>{styles}</style>
    <h1>Fusion Next</h1>
    <p>{tr(lang, '每个会话一支「规划 + 执行」双人组：规划负责拆解、审查与接管，执行负责实际改动。这里汇总所有会话的运行记录与用量。',
      'Each session runs a planner–executor pair: the planner decomposes, reviews and takes over; the executor makes the changes. This page aggregates runs and usage across sessions.')}</p>
    {sessions.length > 0 && <div className="fusion-running" aria-label={tr(lang, '启用 Fusion 的会话', 'Sessions on Fusion Next')}>
      {sessions.map(session => {
        const stage = stageOf(lang, session.task)
        return <span key={session.sessionId} className="fusion-chip" data-attention={session.task?.attention ?? false} data-stage={session.task?.stage ?? ''}>
          <span className="fusion-dot" />
          <b>{labelOf(session)}</b>
          <span>{stage}{session.task?.usage ? ` · ${session.task.usage.calls} 次` : ''}</span>
        </span>
      })}
    </div>}
    <div className="fusion-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'running'} onClick={() => setTab('running')}>
        {tr(lang, `运行中${running.length ? `（${running.length}）` : ''}`, `Running${running.length ? ` (${running.length})` : ''}`)}</button>
      <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>{tr(lang, '历史与统计', 'History & stats')}</button>
      <button role="tab" aria-selected={tab === 'cache'} onClick={() => setTab('cache')}>{tr(lang, '缓存保活', 'Cache keepalive')}</button>
    </div>
    {tab === 'running' && <>
      {running.length === 0 && <p className="fusion-empty">{loaded
        ? tr(lang, '当前没有运行中的 Fusion 任务。在某个会话输入框旁的「执行」选择器挑一个执行模型即可开始。',
            'No fusion tasks are running. Pick an executor beside a session\'s model selector to start one.')
        : tr(lang, '正在读取…', 'Loading…')}</p>}
      {running.length > 0 && <table>
        <thead><tr><th>{tr(lang, '会话', 'Session')}</th><th>{tr(lang, '规划', 'Planner')}</th><th>{tr(lang, '执行', 'Executor')}</th><th>{tr(lang, '当前任务', 'Current task')}</th><th>{tr(lang, '请求', 'Requests')}</th></tr></thead>
        <tbody>{running.map(session => <tr key={session.sessionId}>
          <td><b>{labelOf(session)}</b><small>{session.sessionId}</small></td>
          <td>{session.lead.model}<small>{session.lead.provider}</small></td>
          <td>{session.worker.model}<small>{session.worker.provider}</small></td>
          <td data-attention={session.task?.attention ?? false}>
            {session.task?.attention ? '⚠ ' : ''}{stageOf(lang, session.task)}
            <small>{lang === 'en' && session.task?.detailEn !== undefined ? session.task.detailEn : session.task?.detail ?? ''}</small></td>
          <td>{session.task?.usage?.calls ?? '—'}</td>
        </tr>)}</tbody></table>}
    </>}
    {tab === 'history' && <FusionHistory />}
    {tab === 'cache' && <FusionCache refresh={0} />}
  </main>
}
