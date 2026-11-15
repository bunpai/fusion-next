import { useEffect, useRef, useState } from 'react'
import { tr, useLang } from './i18n.js'

interface RoleTokens { input: number; output: number; cacheRead: number; calls: number }
interface ModelTokens extends RoleTokens { role: string }
interface SessionUsage {
  paired: boolean
  roles: Record<string, RoleTokens>
  models: Record<string, ModelTokens>
  total: RoleTokens
  cacheHit: number | null
}

const fmt = (n: number): string => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`
const sum = (b: { input: number; output: number; cacheRead: number }) => b.input + b.cacheRead + b.output
const pct = (b: { input: number; cacheRead: number }) => {
  const inp = b.input + b.cacheRead
  return inp > 0 ? `${Math.round(b.cacheRead / inp * 100)}%` : '—'
}

/** Executor-only spend beside the composer model row. Click opens a detail
 * popover (per-role and per-model breakdown) like the host usage meter. */
export function FusionUsageBadge({ sessionId }: { sessionId: string }) {
  const lang = useLang()
  const [usage, setUsage] = useState<SessionUsage | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const res = await fetch(`/api/fusion-next?view=session-usage&sessionId=${encodeURIComponent(sessionId)}`)
        if (!res.ok) return
        const body = await res.json() as SessionUsage
        if (live) setUsage(body)
      } catch { /* offline */ }
    }
    void load()
    const timer = setInterval(load, 15_000)
    return () => { live = false; clearInterval(timer) }
  }, [sessionId])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!usage?.paired) return null
  const worker = usage.roles.worker ?? { input: 0, output: 0, cacheRead: 0, calls: 0 }
  const tokens = sum(worker)
  if (!tokens) return null
  const wPct = pct(worker)
  const lead = usage.roles.lead ?? { input: 0, output: 0, cacheRead: 0, calls: 0 }

  const row = (label: string, b: RoleTokens, role?: string) => (
    <div key={label + (role ?? '')} className="urow" data-role={role}>
      <span className="uname">{label}</span>
      <span className="unum">{fmt(b.input)}</span>
      <span className="unum">{fmt(b.cacheRead)}</span>
      <span className="unum">{fmt(b.output)}</span>
      <span className="unum">{pct(b)}</span>
      <span className="unum ucall">{b.calls}</span>
    </div>
  )
  const modelRows = Object.entries(usage.models ?? {})
    .sort((a, b) => sum(b[1]) - sum(a[1]))
    .map(([key, b]) => row(key, b, b.role === 'worker' ? 'worker' : 'lead'))

  return (
    <span className="fusion-usage" ref={box}>
      <button type="button" className="fusion-usage-btn" onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog" aria-expanded={open}
        title={tr(lang, '执行模型用量详情', 'Executor token detail')}>
        {fmt(tokens)} tok{wPct === '—' ? '' : ` · ${wPct}`}
      </button>
      {open && (
        <div className="fusion-usage-pop" role="dialog" aria-label={tr(lang, 'Fusion 会话用量', 'Fusion session usage')}>
          <div className="uhead">{tr(lang, '本会话 token 用量', 'Token usage this session')}</div>
          <div className="ugrid">
            <div className="urow ulabels">
              <span></span><span className="unum">{tr(lang, '输入', 'in')}</span>
              <span className="unum">{tr(lang, '缓存读', 'cache')}</span>
              <span className="unum">{tr(lang, '输出', 'out')}</span>
              <span className="unum">{tr(lang, '命中', 'hit%')}</span>
              <span className="unum ucall">{tr(lang, '调用', 'calls')}</span>
            </div>
            {modelRows}
            <div className="usep" />
            {row(tr(lang, '规划 lead', 'lead'), lead, 'lead')}
            {row(tr(lang, '执行 worker', 'worker'), worker, 'worker')}
            {row(tr(lang, '合计', 'total'), usage.total)}
          </div>
        </div>
      )}
      <style>{`.fusion-usage{position:relative;display:inline-flex;align-items:center}
.fusion-usage-btn{height:28px;padding:0 6px;border:none;background:transparent;cursor:pointer;border-radius:8px;
  font-size:11px;line-height:1;color:var(--dsh-text-2,rgba(255,255,255,.5));white-space:nowrap;
  font-variant-numeric:tabular-nums;user-select:none}
.fusion-usage-btn:hover{background:var(--dsh-hover,rgba(255,255,255,.06));color:var(--dsh-text-1,rgba(255,255,255,.8))}
.fusion-usage-pop{position:absolute;bottom:34px;right:0;z-index:50;min-width:430px;padding:10px 12px;
  background:var(--dsh-bg-pop,#1c1e22);border:1px solid var(--dsh-border,rgba(255,255,255,.1));border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.45);font-size:11px;color:var(--dsh-text-1,rgba(255,255,255,.85))}
.fusion-usage-pop .uhead{font-weight:600;font-size:12px;margin-bottom:8px}
.fusion-usage-pop .ugrid{display:flex;flex-direction:column;gap:2px}
.fusion-usage-pop .urow{display:grid;grid-template-columns:1fr repeat(5,54px);gap:4px;align-items:baseline}
.fusion-usage-pop .ulabels{color:var(--dsh-text-2,rgba(255,255,255,.45));font-size:10px}
.fusion-usage-pop .uname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
.fusion-usage-pop .urow[data-role] .uname::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:middle}
.fusion-usage-pop .urow[data-role='lead'] .uname::before{background:#7aa2f7}
.fusion-usage-pop .urow[data-role='worker'] .uname::before{background:#9ece6a}
.fusion-usage-pop .unum{text-align:right;font-variant-numeric:tabular-nums}
.fusion-usage-pop .usep{height:1px;margin:6px 0 2px;background:var(--dsh-border,rgba(255,255,255,.1))}`}</style>
    </span>
  )
}
