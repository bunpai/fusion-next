import { useEffect, useState } from 'react'
import type { PhysicalRoute } from '../contracts.js'
import type { PairChoice, SettingsCatalog } from '../host/settings.js'
import { settingsChanged } from './settings-events.js'
import { tr, useLang } from './i18n.js'

interface SettingsState {
  revision: number
  catalog: SettingsCatalog
  pair: PairChoice | null
  authorized: boolean
  managedAuthorization?: boolean
  reason?: string
}
const styles = `
.fusion-settings{max-width:560px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:16px}
.fusion-settings h2{margin:0;font-size:20px;line-height:28px;font-weight:600}
.fusion-settings p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.fusion-settings .fusion-card{padding:18px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;gap:16px;background:var(--dsw-alias-bg-module-platform)}
.fusion-settings fieldset{padding:0;margin:0;border:0;min-inline-size:0;display:flex;flex-direction:column;gap:6px}
.fusion-settings legend{font-size:14px;font-weight:600;padding:0}
.fusion-settings fieldset>p{font-size:12px}
.fusion-settings label{display:grid;grid-template-columns:88px minmax(0,1fr);align-items:center;gap:12px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.fusion-settings :is(select,option,optgroup){background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);color-scheme:inherit}
.fusion-settings select{box-sizing:border-box;min-width:0;width:100%;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:0 9px;font:inherit;color:var(--dsw-alias-label-primary)}
.fusion-settings .fusion-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px}
.fusion-settings .fusion-actions>p{margin-right:auto}
.fusion-settings button{height:34px;border:1px solid transparent;border-radius:17px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);padding:0 18px;font:inherit;font-size:13px;cursor:pointer}
.fusion-settings button:disabled{opacity:.5;cursor:default}
.fusion-settings :is(button,select):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.fusion-settings [role=alert]{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.fusion-settings details{font-size:13px;line-height:20px}
.fusion-settings summary{cursor:pointer;font-weight:500;color:var(--dsw-alias-label-secondary)}
.fusion-settings .fusion-limits{display:flex;flex-direction:column;gap:12px;padding-top:10px}
.fusion-settings input[type=number]{min-width:0;width:100%;box-sizing:border-box;height:34px;background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:0 9px;font:inherit}
@media(max-width:480px){.fusion-settings label{grid-template-columns:1fr;gap:6px}}
`

const key = (route: PhysicalRoute | undefined) => route ? JSON.stringify([route.provider, route.model]) : ''

export function ModelChoice({ role, route, catalog, onChange }: {
  role: 'Lead' | 'Sidekick' | 'compactor'; route?: PhysicalRoute; catalog: SettingsCatalog; onChange(route: PhysicalRoute | undefined): void
}) {
  const lang = useLang()
  const name = role === 'Lead' ? tr(lang, '规划', 'Planner') : role === 'Sidekick' ? tr(lang, '执行', 'Executor') : tr(lang, '压缩', 'Compaction')
  const model = catalog.groups.find(group => group.id === route?.provider)?.models.find(model => model.id === route?.model)
  return <fieldset>
    <legend>{name}</legend>
    <label>{tr(lang, '模型', 'Model')}<select aria-label={tr(lang, `${name} 模型`, `${name} model`)} value={key(route)} onChange={event => {
      if (!event.target.value) { onChange(undefined); return }
      const [provider, model] = JSON.parse(event.target.value) as [string, string]
      onChange({ provider, model })
    }}>
      <option value="" disabled={role !== 'compactor'}>{role === 'compactor' ? tr(lang, '跟随角色模型', 'Use the role\'s own model') : tr(lang, '选择模型', 'Choose a model')}</option>
      {catalog.groups.map(group => <optgroup key={group.id} label={group.name}>
        {group.models.map(model => <option key={model.id} value={key({ provider: group.id, model: model.id })}>{model.name}</option>)}
      </optgroup>)}
    </select></label>
    {model?.reasoning && route && <label>{tr(lang, '推理强度', 'Reasoning')}<select aria-label={tr(lang, `${name} 推理强度`, `${name} reasoning`)} value={route.reasoningEffort ?? ''} onChange={event => {
      const { reasoningEffort: _old, ...physical } = route
      onChange({ ...physical, ...(event.target.value ? { reasoningEffort: event.target.value } : {}) })
    }}>
      <option value="">{tr(lang, '模型默认', 'Model default')}{model.reasoning.defaultEffort ? ` · ${model.reasoning.defaultEffort}` : ''}</option>
      {model.reasoning.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
    </select></label>}
  </fieldset>
}

export function FusionSettings() {
  const lang = useLang()
  const [state, setState] = useState<SettingsState>()
  const [draft, setDraft] = useState<Partial<PairChoice>>({})
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [saving, setSaving] = useState(false)
  const chooseModel = (role: 'lead' | 'worker', route: PhysicalRoute) => setDraft(value => ({ ...value, [role]: route,
    ...(value.cacheKeepalive ? { cacheKeepalive: { ...value.cacheKeepalive, [role]: role === 'lead' ? 'auto' : false } } : {}) }))
  useEffect(() => {
    const abort = new AbortController()
    void fetch('/api/fusion-next?view=settings', { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
      .then(async response => { if (!response.ok) throw new Error(tr(lang, '无法读取 Fusion Next 设置', 'Cannot read Fusion Next settings')); return response.json() as Promise<SettingsState> })
      .then(value => { setState(value); setDraft(value.pair ?? {}) })
      .catch(error => { if (!abort.signal.aborted) setError(String(error)) })
    return () => abort.abort()
  }, [])
  const save = async () => {
    if (!state || !draft.lead || !draft.worker) return
    setSaving(true); setError(undefined); setNotice(undefined)
    try {
      const { outputTokens, ...rest } = draft
      const limits = Object.fromEntries(Object.entries(outputTokens ?? {}).filter(([, tokens]) => Number.isSafeInteger(tokens) && Number(tokens) > 0))
      const pair = { ...rest, ...(Object.keys(limits).length ? { outputTokens: limits } : {}) }
      const response = await fetch('/api/fusion-next', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'configure', revision: state.revision, pair }) })
      const result = await response.json() as { revision: number; error?: string }
      if (!response.ok) throw new Error(result.error ?? tr(lang, '保存失败，请刷新后重试', 'Save failed; refresh and try again'))
      const current = await fetch('/api/fusion-next?view=settings', { credentials: 'same-origin', cache: 'no-store' })
      if (!current.ok) throw new Error(tr(lang, '配置已提交，但暂时无法确认，请刷新', 'Saved, but not confirmed yet; refresh'))
      const confirmed = await current.json() as SettingsState
      setState(confirmed); setDraft(confirmed.pair ?? {})
      settingsChanged()
      setNotice(tr(lang, '默认组合已保存。', 'Default pair saved.'))
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  return <div className="fusion-settings">
    <style>{styles}</style>
    <header><h2>Fusion Next</h2><p>{tr(lang, '默认的「规划 + 执行」组合。会话里直接挑执行模型即可开启双模型协作；规划 = 会话模型本身。执行越便宜越省。',
      'The default planner–executor pair. Pick an executor beside a session\'s model selector to start two-model collaboration; the planner is the session model itself. A cheaper executor saves more.')}</p></header>
    {error && <p role="alert">{error}</p>}
    {!state && !error && <p role="status">{tr(lang, '正在读取模型…', 'Loading models…')}</p>}
    {state && <>
      <fieldset className="fusion-card" disabled={saving}>
        <ModelChoice role="Lead" route={draft.lead} catalog={state.catalog} onChange={route => { if (route) chooseModel('lead', route) }} />
        <ModelChoice role="Sidekick" route={draft.worker} catalog={state.catalog} onChange={route => { if (route) chooseModel('worker', route) }} />
        <label>{tr(lang, '规划权限', 'Planner mode')}
          <select aria-label={tr(lang, '规划模型权限', 'Planner access mode')} value={draft.leadConfinement ?? 'read-only'}
            onChange={event => setDraft(value => ({ ...value, leadConfinement: event.target.value === 'user-mode' ? 'user-mode' : 'read-only' }))}>
            <option value="read-only">{tr(lang, '只读（推荐：所有改动都过执行模型验收）', 'Read-only (recommended: all changes go through executor review)')}</option>
            <option value="user-mode">{tr(lang, '跟随你的权限（规划模型可直接改，改动不经验收）', 'Follow your mode (planner can change files directly, unreviewed)')}</option>
          </select>
        </label>
        <details><summary>{tr(lang, '压缩模型 · 可选', 'Compaction model · optional')}</summary>
          <div className="fusion-limits">
            <p>{tr(lang, '默认由角色自己的模型压缩，也可单独指定（由所选账号计费）。', 'Each role compacts with its own model unless you pin another (billed to that account).')}</p>
            <ModelChoice role="compactor" route={draft.compactor?.route} catalog={state.catalog} onChange={route => setDraft(value => {
              const { compactor, ...rest } = value
              return route ? { ...rest, compactor: { route, maxOutputTokens: compactor?.maxOutputTokens ?? 8192 } } : rest
            })} />
            {draft.compactor && <label>{tr(lang, '输出上限', 'Output limit')}<input aria-label={tr(lang, '压缩输出 Token 上限', 'Compaction output token limit')} type="number" min="1" max="128000"
              value={draft.compactor.maxOutputTokens} onChange={event => { const maxOutputTokens = Number(event.target.value)
                setDraft(value => value.compactor ? { ...value, compactor: { ...value.compactor, maxOutputTokens } } : value) }} /></label>}
          </div>
        </details>
      </fieldset>
      <div className="fusion-actions"><p>{tr(lang, '已配对的会话保留原组合。', 'Already-paired sessions keep their pair.')}</p>
        <button disabled={saving || !draft.lead || !draft.worker || JSON.stringify(draft) === JSON.stringify(state.pair)} onClick={() => { void save() }}>{saving ? tr(lang, '正在保存…', 'Saving…') : tr(lang, '保存', 'Save')}</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      <p>{tr(lang, '保存即表示允许 Fusion Next 使用所选模型的现有账号；费用由这些账号计入。', 'Saving lets Fusion Next use the chosen models\' existing accounts; they are billed there.')}</p>
      {state.pair && !state.authorized && <p role="status">{tr(lang, '组合需要重新保存后才能使用', 'Save the pair again before use')}{state.reason ? `: ${state.reason}` : ''}</p>}
      {state.managedAuthorization && <p>{tr(lang, '运行额度由外部授权配置管理。', 'Run limits are managed by an external authorization file.')}</p>}
    </>}
  </div>
}
