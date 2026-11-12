import { tr, useLang } from './i18n.js'
import { useEffect, useState } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PhysicalRoute } from '../contracts.js'
import { FusionStatus } from './FusionStatus.js'

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

const keyOf = (route: PhysicalRoute) => `${route.provider}/${route.model}`
const routeOf = (key: string): PhysicalRoute | undefined => {
  const cut = key.indexOf('/')
  return cut > 0 ? { provider: key.slice(0, cut), model: key.slice(cut + 1) } : undefined
}

/**
 * Composer executor picker: the session's normal model menu is the planner;
 * this second dropdown sets the executor for this session (bound like a normal
 * model). Closing the executor returns the session to a plain model session.
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
    if (value) {
      try { localStorage.setItem('fusion-next:last-executor', value) } catch { /* storage unavailable */ }
    }
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
  const lastExecutor = () => {
    try { return localStorage.getItem('fusion-next:last-executor') ?? '' } catch { return '' }
  }
  const firstModel = () => {
    const group = groups[0], model = group?.models[0]
    return group && model ? `${group.id}/${model.id}` : ''
  }
  const toggle = () => choose(view?.worker ? '' : (lastExecutor() || firstModel()))
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 12px 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
    <button type="button" onClick={toggle} disabled={busy} role="switch" aria-checked={Boolean(view?.worker)}
      aria-label={tr(lang, '开关本会话 Fusion Next', 'Toggle Fusion Next for this session')}
      style={{ flexShrink: 0, fontSize: 12, padding: '2px 8px', minHeight: 26, borderRadius: 6, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2)', backgroundColor: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)' }}>
      {view?.worker ? tr(lang, 'Fusion ●', 'Fusion ●') : tr(lang, 'Fusion ○', 'Fusion ○')}
    </button>
    <span style={{ flexShrink: 0 }}>{tr(lang, '执行', 'Executor')}</span>
    <select aria-label={tr(lang, '执行模型', 'Executor model')} value={current} disabled={busy}
      onChange={event => choose(event.target.value)}
      style={{ minHeight: 26, fontSize: 12, maxWidth: 240,
        backgroundColor: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '2px 6px' }}>
      <option value="">{tr(lang, '关闭（普通会话）', 'Off (normal session)')}</option>
      {groups.map(group => <optgroup key={group.id} label={group.name}>
        {group.models.map(model => <option key={model.id} value={`${group.id}/${model.id}`}>{model.name}</option>)}
      </optgroup>)}
    </select>
    {view?.selected && <span style={{ flexShrink: 0 }}>{tr(lang, '· Fusion Next 进行中', '· Fusion active')}</span>}
    {error && <span role="status" style={{ color: 'var(--dsw-alias-error, #d33)' }}>{error}</span>}
    {view?.worker && <FusionStatus sessionId={sessionId} attentionOnly />}
  </div>
}
