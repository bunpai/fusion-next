import { useState } from 'react'
import { tr, useLang } from './i18n.js'
import { FusionHistory } from './FusionHistory.js'

/** Sidebar rail glyph: two linked nodes, the planner-executor pair. */
export function FusionNextIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12.5" cy="12.5" r="3" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7.8 7.8 10.2 10.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
}
import { FusionCache } from './FusionCache.js'

const styles = `
.fusion-panel{padding:20px 24px;max-width:920px;overflow:auto;height:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
.fusion-panel h1{font-size:18px;margin:0 0 4px;font-weight:600}
.fusion-panel>p{margin:0 0 16px;color:var(--dsw-alias-label-secondary)}
.fusion-panel .fusion-history,.fusion-panel .fusion-cache{margin:0 0 28px}
.fusion-panel table{border-collapse:collapse;width:100%}
.fusion-panel :is(th,td){text-align:left;padding:6px 10px 6px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-weight:400}
.fusion-panel thead th{color:var(--dsw-alias-label-secondary);font-weight:600}
.fusion-panel small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px}
.fusion-panel button{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 12px;background-color:var(--dsw-alias-button-elevated-fill);cursor:pointer}
.fusion-panel button:disabled{opacity:.5;cursor:default}
.fusion-panel .fusion-actions{display:flex;gap:8px;margin:8px 0}
.fusion-panel h2{font-size:14px;margin:0 0 8px;font-weight:600}
.fusion-panel h3{font-size:13px;margin:14px 0 6px;font-weight:600}
.fusion-panel ol,.fusion-panel ul{margin:0;padding-left:20px}
.fusion-panel li{margin:0 0 10px}
.fusion-panel [role=alert]{color:var(--dsw-alias-state-error-primary)}
.fusion-panel select,.fusion-panel input{font:inherit;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 6px;color-scheme:inherit}
`

/**
 * Global console behind the sidebar icon: cross-session run history, usage
 * totals and the cache-keepalive ledger. Per-session controls live in the
 * conversation View; global defaults stay in Settings.
 */
export function FusionPanel() {
  const lang = useLang()
  const [refresh] = useState(0)
  return <main className="fusion-panel" aria-label={tr(lang, 'Fusion Next 控制台', 'Fusion Next console')} data-ud-check="fusion-panel">
    <style>{styles}</style>
    <h1>Fusion Next</h1>
    <p>{tr(lang, '每个会话一支「规划 + 执行」双人组：规划负责拆解、审查与接管，执行负责实际改动。这里汇总所有会话的运行记录与用量。',
      'Each session runs a planner–executor pair: the planner decomposes, reviews and takes over; the executor makes the changes. This page aggregates runs and usage across sessions.')}</p>
    <FusionHistory />
    <FusionCache refresh={refresh} />
  </main>
}
