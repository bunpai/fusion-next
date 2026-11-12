import { useEffect, useState } from 'react'
import { tr, useLang } from './i18n.js'
import type { PhysicalRoute } from '../contracts.js'
import { FusionStatus } from './FusionStatus.js'

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
.fusion-console .fusion-status{margin:12px 0 0}
`

/**
 * Per-session console in the conversation View row: which pair drives this
 * session, and the live task ledger (stage, usage, requests, recovery).
 * The composer executor picker remains the control surface; this view reads.
 */
export function FusionConsole({ sessionId }: { sessionId?: string }) {
  const lang = useLang()
  const [pair, setPair] = useState<PairView>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!sessionId) { setPair(undefined); return }
    const abort = new AbortController()
    const load = () => {
      void fetch(`/api/fusion-next?view=session-pair&sessionId=${encodeURIComponent(sessionId)}`,
        { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
        .then(async response => {
          if (!response.ok) throw new Error('unavailable')
          const view = await response.json() as PairView
          setPair(view); setFailed(false)
        })
        .catch(() => { if (!abort.signal.aborted) setFailed(true) })
    }
    load()
    const timer = setInterval(load, 15000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [sessionId])
  if (!sessionId) return null
  return <section className="fusion-console" aria-label={tr(lang, 'Fusion Next 会话面板', 'Fusion Next session console')} data-ud-check="fusion-console">
    <style>{styles}</style>
    <h2>Fusion Next</h2>
    {pair?.worker ? <div className="fusion-pair">
      <div><b>{tr(lang, '规划', 'Planner')}</b><small>{routeLabel(pair.lead) ?? tr(lang, '跟随会话模型', 'follows the session model')}</small></div>
      <div><b>{tr(lang, '执行', 'Executor')}</b><small>{routeLabel(pair.worker)}</small></div>
      <div><b>{tr(lang, '状态', 'State')}</b><small>{pair.selected ? tr(lang, '进行中', 'active') : tr(lang, '已配置，发送消息后开始', 'paired; starts on the next message')}</small></div>
    </div> : <p className="fusion-console-note">{failed
      ? tr(lang, '暂时无法读取 Fusion 状态，稍后自动重试。', 'Fusion status is unavailable right now; it retries automatically.')
      : tr(lang, '本会话未启用 Fusion Next：在输入框上方的「执行」选择器挑一个执行模型即可开启双模型协作。',
          'Fusion Next is off in this session: pick an executor in the picker above the composer to start two-model collaboration.')}</p>}
    {pair?.worker && <FusionStatus sessionId={sessionId} />}
  </section>
}
