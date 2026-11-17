import { tr, useLang } from './i18n.js'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
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
  executorMode?: string | null
  catalog?: { groups: CatalogGroup[] }
}

const styles = `
.fusion-executor{display:flex;align-items:center;gap:6px;min-width:0}
.fusion-executor .fusion-executor-mark{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);flex:none}
.fusion-executor .fusion-executor-label{display:var(--dsh-composer-model-text-display,inline);font-size:12px;white-space:nowrap}
.fusion-executor select{appearance:none;-webkit-appearance:none;font:inherit;font-size:13px;height:28px;width:auto;min-width:0;max-width:150px;padding:0 18px 0 4px;border-radius:8px;cursor:pointer;
  border:0;background-color:transparent;color:var(--dsw-alias-label-primary);color-scheme:inherit;
  text-overflow:ellipsis;white-space:nowrap;overflow:hidden;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16'><path d='M4.5 6.5l3.5 3.5 3.5-3.5' fill='none' stroke='%23999' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat:no-repeat;background-position:right 4px center}
.fusion-executor .fusion-executor-sizer{visibility:hidden;position:absolute;height:0;overflow:hidden;white-space:nowrap;font-size:13px;pointer-events:none}
.fusion-executor select:hover{background-color:var(--dsw-alias-bg-layer-1)}
.fusion-executor select[data-active=true]{color:var(--dsw-alias-brand-primary)}
.fusion-executor select:disabled{cursor:default;opacity:.6}
.fusion-executor select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.fusion-executor [role=status]{font-size:12px;color:var(--dsw-alias-state-error-primary);white-space:nowrap}
.fusion-executor .fusion-executor-mode{display:var(--dsh-composer-model-text-display,inline);font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-primary);color:var(--dsw-alias-label-secondary);flex:none}
`

const keyOf = (route: PhysicalRoute) => `${route.provider}/${route.model}`
const MODE_LABEL: Record<string, string> = {
  'read-only': '只读',
  'workspace-write': '工作区修改',
  'danger-full-access': '完全权限',
}
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
  // Remote pages cannot reach the plugin HTTP API (trustedRequest is
  // loopback-only by design). The authenticated commands channel works
  // everywhere, so reading and writing the pair falls back to
  // `/fusion-next pair` there.
  const cmdPair = async (line: string): Promise<string | undefined> => {
    const res = await fetch('api/commands/execute', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'commands/execute',
        payload: { args: { agentId: sessionId, line, submittedAttachments: [] } } }),
    })
    if (!res.ok) return undefined
    const body = await res.json().catch(() => undefined) as
      { result?: { value?: { result?: { text?: string }; text?: string } } } | undefined
    return body?.result?.value?.result?.text ?? body?.result?.value?.text
  }
  const refreshViaCommand = async () => {
    const text = await cmdPair('/fusion-next pair')
    const found = text?.match(/执行模型[：:]\s*([^\s（(]+)|Executor:\s*([^\s(]+)/i)
    const worker = found ? routeOf(found[1] ?? found[2] ?? '') ?? null : null
    const modeFound = text?.match(/执行权限[：:]?\s*([a-z-]+)|executor mode\s+([a-z-]+)/i)
    setView(text === undefined ? undefined : { worker, lead: null, selected: Boolean(worker),
      executorMode: modeFound?.[1] ?? modeFound?.[2] ?? null })
  }
  const refresh = () => {
    void fetch(`/api/fusion-next?view=session-pair&sessionId=${encodeURIComponent(sessionId)}`,
      { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => response.ok ? response.json() as Promise<PairView> : undefined)
      .then(async data => data === undefined ? void refreshViaCommand() : setView(data))
      .catch(() => void refreshViaCommand())
  }
  useEffect(() => {
    load(); refresh()
    // The executor-mode badge rides the sandbox-intent document, which only
    // exists after the session's first request — poll so it surfaces without
    // a page switch.
    const timer = setInterval(refresh, 15000)
    return () => clearInterval(timer)
  }, [load, sessionId])
  const choose = (value: string) => {
    if (busy) return
    setBusy(true); setError(undefined)
    void fetch('/api/fusion-next', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'session-pair', sessionId, worker: value ? routeOf(value) ?? null : null }),
    }).then(async response => {
      if (response.ok) { refresh(); return }
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (response.status === 401 || response.status === 403) {
        // Remote page: pair through the authenticated commands channel.
        const text = await cmdPair(`/fusion-next pair ${value || 'off'}`)
        if (text === undefined)
          throw new Error(tr(lang, `远程模式：请发送 /fusion-next pair ${value || 'off'}`, `Remote mode: send /fusion-next pair ${value || 'off'}`))
        void refreshViaCommand()
        return
      }
      throw new Error(body.error ?? `HTTP ${response.status}`)
    }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  // The Host model directory is the same catalog the native selector renders
  // from — it works on remote pages too, unlike the plugin's local-only HTTP
  // API (trustedRequest). Prefer it; keep the API catalog as fallback.
  const dirState = useSyncExternalStore(directory.subscribe, directory.getSnapshot)
  const groups: CatalogGroup[] = dirState.groups.length
    ? dirState.groups.map(group => ({ id: group.id, name: group.name, models: group.models.map(model => ({ id: model.id, name: model.name })) }))
    : view?.catalog?.groups ?? []
  const current = view?.worker ? keyOf(view.worker) : ''
  const offLabel = tr(lang, '关闭', 'Off')
  let selectedLabel = offLabel
  if (current) {
    for (const group of groups) {
      const found = group.models.find(model => `${group.id}/${model.id}` === current)
      if (found) { selectedLabel = found.name; break }
    }
    if (selectedLabel === offLabel) selectedLabel = current
  }
  const sizerRef = useRef<HTMLSpanElement>(null)
  const [selectWidth, setSelectWidth] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const sizer = sizerRef.current
    if (!sizer) return
    const measured = Math.ceil(sizer.getBoundingClientRect().width) + 26
    setSelectWidth(Math.min(Math.max(measured, 44), 240))
  }, [selectedLabel])
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
      style={selectWidth ? { width: selectWidth } : undefined}
      onChange={event => choose(event.target.value)}>
      <option value="">{offLabel}</option>
      {groups.map(group => <optgroup key={group.id} label={group.name}>
        {group.models.map(model => <option key={model.id} value={`${group.id}/${model.id}`}>{model.name}</option>)}
      </optgroup>)}
    </select>
    <span ref={sizerRef} className="fusion-executor-sizer" aria-hidden="true">{selectedLabel}</span>
    {current && view?.executorMode && <span className="fusion-executor-mode"
      title={tr(lang, `执行模型权限：${view.executorMode}`, `Executor mode: ${view.executorMode}`)}>
      {MODE_LABEL[view.executorMode] ?? view.executorMode}</span>}
    {error && <span role="status" title={error}>⚠</span>}
  </div>
}
