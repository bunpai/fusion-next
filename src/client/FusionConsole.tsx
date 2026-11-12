import { useEffect, useState } from 'react'
import { tr, useLang } from './i18n.js'
import type { PhysicalRoute } from '../contracts.js'
import { useFusionStatus } from './status-polling.js'
import { FusionTaskActivity, FusionTaskOverview } from './FusionStatus.js'

interface PairView {
  worker: PhysicalRoute | null
  lead: PhysicalRoute | null
  selected: boolean
}

const routeLabel = (route: PhysicalRoute | null | undefined) =>
  route ? `${route.model}` : undefined

const styles = `
.fusion-console{padding:16px 20px;max-width:860px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
.fusion-console h2{font-size:15px;margin:0 0 12px;font-weight:600}
.fusion-console .fusion-pair{display:flex;flex-wrap:wrap;gap:8px 20px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.fusion-console .fusion-pair b{font-weight:600}
.fusion-console .fusion-pair small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px}
.fusion-console .fusion-console-note{margin:16px 0;color:var(--dsw-alias-label-secondary)}
.fusion-console .fusion-tabs{display:flex;gap:4px;margin:16px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.fusion-console .fusion-tabs button{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:none;border:0;border-bottom:2px solid transparent;padding:6px 10px;cursor:pointer}
.fusion-console .fusion-tabs button[aria-selected=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.fusion-console .fusion-recovery fieldset{border:0;padding:0;display:flex;flex-direction:column;gap:10px}.fusion-console .fusion-recovery :is(button,select,input){font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:7px;max-width:100%}.fusion-console .fusion-recovery :is(select,input,option,optgroup){background-color:var(--dsw-alias-bg-layer-1);color-scheme:inherit}.fusion-console .fusion-recovery button{cursor:pointer;background-color:var(--dsw-alias-button-elevated-fill)}.fusion-console .fusion-recovery [role=alert]{color:var(--dsw-alias-state-error-primary)}
.fusion-console p{margin:4px 0 12px}.fusion-console h3{font-size:13px;margin:16px 0 4px;font-weight:600}
.fusion-console dl{margin:0;display:grid;grid-template-columns:minmax(72px,auto) minmax(0,1fr);gap:4px 12px}
.fusion-console dt{color:var(--dsw-alias-label-secondary)}.fusion-console dd{margin:0;min-width:0}
.fusion-console ul{list-style:none;margin:0;padding:0}.fusion-console li{padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.fusion-console small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px}
.fusion-console .fusion-stage{font-size:14px;font-weight:600;margin:0 0 4px}
.fusion-console .fusion-stage[data-attention=true]{color:var(--dsw-alias-state-error-primary)}
`

type Tab = 'task' | 'activity'

/**
 * Per-session console in the conversation View row: pair summary plus the
 * merged task ledger (current task tab + requests/usage tab). The composer
 * executor picker remains the control surface; this view reads.
 */
export function FusionConsole({ sessionId }: { sessionId?: string }) {
  const lang = useLang()
  const [pair, setPair] = useState<PairView>()
  const [pairFailed, setPairFailed] = useState(false)
  const [tab, setTab] = useState<Tab>('task')
  const snapshot = useFusionStatus(sessionId ?? '', undefined)
  useEffect(() => {
    if (!sessionId) { setPair(undefined); return }
    const abort = new AbortController()
    const load = () => {
      void fetch(`/api/fusion-next?view=session-pair&sessionId=${encodeURIComponent(sessionId)}`,
        { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
        .then(async response => {
          if (!response.ok) throw new Error('unavailable')
          const view = await response.json() as PairView
          setPair(view); setPairFailed(false)
        })
        .catch(() => { if (!abort.signal.aborted) setPairFailed(true) })
    }
    load()
    const timer = setInterval(load, 15000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [sessionId])
  if (!sessionId) return null
  const task = snapshot?.status?.selected ? snapshot.status.task : undefined
  const stage = task ? (lang === 'en' ? task.stageEn ?? task.stage : task.stage) : undefined
  return <section className="fusion-console" aria-label={tr(lang, 'Fusion Next 会话面板', 'Fusion Next session console')} data-ud-check="fusion-console">
    <style>{styles}</style>
    <h2>Fusion Next</h2>
    {pair?.worker ? <div className="fusion-pair">
      <div><b>{tr(lang, '规划', 'Planner')}</b><small>{routeLabel(pair.lead) ?? tr(lang, '跟随会话模型', 'follows the session model')}</small></div>
      <div><b>{tr(lang, '执行', 'Executor')}</b><small>{routeLabel(pair.worker)}</small></div>
      <div><b>{tr(lang, '状态', 'State')}</b><small>{pair.selected ? stage ?? tr(lang, '进行中', 'active') : tr(lang, '已配置，发送消息后开始', 'paired; starts on the next message')}</small></div>
    </div> : <p className="fusion-console-note">{pairFailed
      ? tr(lang, '暂时无法读取 Fusion 状态，稍后自动重试。', 'Fusion status is unavailable right now; it retries automatically.')
      : tr(lang, '本会话未启用 Fusion Next：在输入框上方的「执行」选择器挑一个执行模型即可开启双模型协作。',
          'Fusion Next is off in this session: pick an executor in the picker above the composer to start two-model collaboration.')}</p>}
    {task && <>
      <div className="fusion-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'task'} onClick={() => setTab('task')}>{tr(lang, '当前任务', 'Current task')}</button>
        <button role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>{tr(lang, '请求与用量', 'Requests & usage')}</button>
      </div>
      {tab === 'task' && <>
        <p className="fusion-stage" data-attention={task.attention}>{stage}</p>
        <FusionTaskOverview sessionId={sessionId} task={task} />
      </>}
      {tab === 'activity' && <FusionTaskActivity task={task} />}
    </>}
    {pair?.worker && !task && <p className="fusion-console-note" role="status">
      {tr(lang, '尚无进行中的任务。发送消息后这里会显示任务阶段与用量。', 'No task yet. Task stage and usage appear here after you send a message.')}</p>}
  </section>
}
