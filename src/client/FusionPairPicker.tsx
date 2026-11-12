import { tr, useLang } from './i18n.js'
import { useEffect, useState } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PhysicalRoute } from '../contracts.js'

export interface FusionPairPickerProps {
  sessionId: string
  directory: ObservableSnapshot<ModelDirectoryState>
  load(): void
}

interface CatalogGroup { id: string; name: string; models: { id: string; name: string }[] }
interface PairView {
  worker: PhysicalRoute | null
  lead: PhysicalRoute | null
  selected: boolean
  catalog?: { groups: CatalogGroup[] }
}

const styles = `
.fusion-executor{display:flex;align-items:center;gap:6px;min-width:0}
.fusion-executor .fusion-executor-mark{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);flex:none}
.fusion-executor .fusion-executor-label{display:var(--dsh-composer-model-text-display,inline);font-size:12px;white-space:nowrap}
.fusion-executor select{font:inherit;font-size:12px;height:28px;max-width:190px;min-width:0;padding:0 6px;border-radius:6px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);color-scheme:inherit;
  text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.fusion-executor select[data-active=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.fusion-executor select:disabled{cursor:default;opacity:.6}
.fusion-executor select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.fusion-executor [role=status]{font-size:12px;color:var(--dsw-alias-state-error-primary);white-space:nowrap}
`

const keyOf = (route: PhysicalRoute) => `${route.provider}/${route.model}`
const routeOf = (key: string): PhysicalRoute | undefined => {
  const cut = key.indexOf('/')
  return cut > 0 ? { provider: key.slice(0, cut), model: key.slice(cut + 1) } : undefined
}

/**
 * Composer tool-row executor picker, next to the native model selector: the
 * session's own model is the planner; picking an executor here turns Fusion
 * Next on for this session, choosing Off returns it to a plain session.
 */
export function FusionPairPicker({ sessionId, directory, load }: FusionPairPickerProps) {
  const lang = useLang()
  const [view, setView] = useState<PairView | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const refresh = () => {
    void fetch(`/api/fusion-next?view=session-pair&sessionId=${encodeURIComponent(sessionId)}`,
      { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => response.ok ? response.json() as Promise<PairView> : undefined)
      .then(data => setView(data))
      .catch(() => setView(undefined))
  }
  useEffect(() => { load(); refresh() }, [load, sessionId])
  const choose = (value: string) => {
    if (busy) return
    setBusy(true); setError(undefined)
    void fetch('/api/fusion-next', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'session-pair', sessionId, worker: value ? routeOf(value) ?? null : null }),
    }).then(async response => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      refresh()
    }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  const groups = view?.catalog?.groups ?? []
  const current = view?.worker ? keyOf(view.worker) : ''
  return <div className="fusion-executor" data-ud-check="fusion-executor">
    <style>{styles}</style>
    <span className="fusion-executor-mark" title={tr(lang, 'Fusion Next 执行模型', 'Fusion Next executor')}>
      <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="12.5" cy="12.5" r="3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7.8 7.8 10.2 10.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="fusion-executor-label">{tr(lang, '执行', 'Exec')}</span>
    </span>
    <select aria-label={tr(lang, '执行模型；选一个即开启 Fusion Next', 'Executor model; picking one enables Fusion Next')}
      value={current} disabled={busy} data-active={Boolean(view?.worker)}
      onChange={event => choose(event.target.value)}>
      <option value="">{tr(lang, '关闭', 'Off')}</option>
      {groups.map(group => <optgroup key={group.id} label={group.name}>
        {group.models.map(model => <option key={model.id} value={`${group.id}/${model.id}`}>{model.name}</option>)}
      </optgroup>)}
    </select>
    {error && <span role="status" title={error}>⚠</span>}
  </div>
}
