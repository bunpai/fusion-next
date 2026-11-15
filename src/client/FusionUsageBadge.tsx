import { useEffect, useState } from 'react'
import { tr, useLang } from './i18n.js'

interface RoleTokens { input: number; output: number; cacheRead: number }
interface SessionUsage {
  paired: boolean
  roles: Record<string, RoleTokens>
  total: RoleTokens
  cacheHit: number | null
}

const fmt = (n: number): string => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`

/** Tokens used by this Fusion session (lead + worker) beside the composer
 * model row. Polls the plugin's usage ledger; renders nothing while the
 * session has no recorded Fusion usage. */
export function FusionUsageBadge({ sessionId }: { sessionId: string }) {
  const lang = useLang()
  const [usage, setUsage] = useState<SessionUsage | null>(null)

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

  const total = usage?.total
  const tokens = total ? total.input + total.cacheRead + total.output : 0
  if (!usage?.paired || !tokens) return null

  const pct = usage.cacheHit === null ? null : Math.round(usage.cacheHit * 100)
  const lead = usage.roles.lead ?? { input: 0, output: 0, cacheRead: 0 }
  const worker = usage.roles.worker ?? { input: 0, output: 0, cacheRead: 0 }
  const sum = (b: RoleTokens) => b.input + b.cacheRead + b.output
  const tip = `${tr(lang, '规划 lead', 'lead')}: ${fmt(sum(lead))} tok\n${tr(lang, '执行 worker', 'worker')}: ${fmt(sum(worker))} tok`
    + (pct === null ? '' : `\n${tr(lang, '缓存命中', 'cache hit')}: ${pct}%`)
  return (
    <span className="fusion-usage" title={tip}>
      {fmt(tokens)} tok{pct === null ? '' : ` · ${pct}%`}
      <style>{`.fusion-usage{display:inline-flex;align-items:center;height:28px;padding:0 6px;
        font-size:11px;line-height:1;color:var(--dsh-text-2,rgba(255,255,255,.5));white-space:nowrap;
        font-variant-numeric:tabular-nums;user-select:none}`}</style>
    </span>
  )
}
