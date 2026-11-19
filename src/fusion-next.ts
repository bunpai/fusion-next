import { bi } from './bilingual.js'
import { backfillHistory, readHistory, readScorecard, type UsageSummary } from './host/history.js'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { FusionCatalogAdapter, FUSION_NEXT_PROVIDER, FUSION_NEXT_MODEL, installNativeFusionSelection, type FusionDispatch } from './host/native-selection.js'
import type { PhysicalRoute } from './contracts.js'
import type { ResolvedProfile } from './profile/resolve.js'
import { choiceFromProfile, modelProfileFromChoice, validatePairChoice, savedLeadRoute, type SettingsCatalog } from './host/settings.js'
import { CachePolicy, cacheView } from './host/cache-policy.js'
import { CACHE_DEFAULTS_CHECKED } from './host/cache-defaults.js'
import { loadJsonObject, resolveProfile, completeProfile } from './profile/resolve.js'
import { loadModelPromptBundle, loadPromptBundle } from './prompts.js'
import { SqliteFusionStore } from './task/sqlite-store.js'
import { BindingRepository } from './host/bindings.js'
import { FusionCoordinator } from './host/coordinator.js'
import { json, readJson, trustedRequest } from './host/http.js'
import { readFusionStatus, readFusionStatusAsync } from './host/status.js'
import { readHistoricalFusionActivity } from './host/native-activity.js'
import { readSessionPair, writeSessionPair, syncSessionPairLead } from './host/session-pair.js'
import { dispatchInFlight } from './host/dispatch-v3.js'
import { createCatalogTripwire } from './host/tripwire.js'

export * from './index.js'

export const name = 'fusion-next'

export const inject = [
	'agents',
	'sessions',
	'llm',
	'tools',
	'subagents',
	'systemPrompt',
	'sessionQuery',
	'commands',
	'agentDefaultModel',
	'tokenMeter',
]

/**
 * v0.3.0 — single-dispatch pair. The v0.2 work-order ceremony (11 tools,
 * verbatim gating, sandbox rewriting, the B01–G03 journal) is gone: the Lead
 * calls fusion_dispatch, the executor runs uninterrupted in one settle, and a
 * deterministic audit returns a bounded bundle. Legacy config keys stay
 * accepted so existing installations keep loading; unused ones are inert.
 */
export interface Config {
  profilePath?: string
  databasePath?: string
  fusionDatabasePath?: string // inert: the v2 journal is retired
  authorizationPath?: string  // inert: request budget was removed
  lifecycleBridge?: boolean   // inert: no journal
  hostSdkVersion?: string
  leadSandbox?: boolean       // inert: host sandbox is the boundary
  workerTools?: string[]
  workerPolicy?: 'inherit' | 'restricted'
}
export const Config: z<Config> = z.object({
  profilePath: z.string(),
  databasePath: z.string(),
  fusionDatabasePath: z.string(),
  authorizationPath: z.string(),
  lifecycleBridge: z.boolean().default(false),
  hostSdkVersion: z.string(),
  leadSandbox: z.boolean().default(true),
  workerTools: z.array(z.string()).default(['bash', 'pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_kill']),
  workerPolicy: z.union([z.const('inherit' as const), z.const('restricted' as const)]).default('inherit' as const),
})

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const database = config.databasePath || join(dshHome, 'plugins', name, 'state.sqlite')
  if (!isAbsolute(database)) throw new Error('Fusion databasePath must be absolute')
  const store = new SqliteFusionStore(database), bindings = new BindingRepository(store)
  const cachePolicy = new CachePolicy(store)
  backfillHistory(store)
  let defaultProfile: ResolvedProfile | undefined
  const physicalCatalog = async (): Promise<SettingsCatalog | undefined> => {
    const sessionController = ctx.get('sessionController')
    if (!sessionController) return undefined
    const catalog = await sessionController.modelCatalog()
    return { ...catalog, groups: catalog.groups.filter(group => group.id !== FUSION_NEXT_PROVIDER) }
  }
  // Headless/desktop-less hosts expose no sessionController: trust the saved document's own routes.
  const catalogFromRaw = (raw: Record<string, unknown>): SettingsCatalog => {
    const efforts = ['off', 'low', 'medium', 'high', 'max'].map(id => ({ id, name: id }))
    const groups = new Map<string, { id: string; name: string; models: { id: string; name: string; reasoning: { efforts: { id: string; name: string }[] } }[] }>()
    for (const role of ['lead', 'worker', 'compactor'] as const) {
      const route = raw[role] as Record<string, unknown> | undefined
      if (typeof route?.provider !== 'string' || typeof route?.model !== 'string') continue
      const group = groups.get(route.provider) ?? { id: route.provider, name: route.provider, models: [] }
      if (!group.models.some(model => model.id === route.model)) group.models.push({ id: route.model, name: route.model, reasoning: { efforts } })
      groups.set(route.provider, group)
    }
    return { groups: [...groups.values()] }
  }
  const configuredProfile = async (): Promise<ResolvedProfile> => {
    defaultProfile = undefined
    const saved = store.readDocument('settings:profile')
    if (!saved && (!config.profilePath || !isAbsolute(config.profilePath))) throw new Error(bi('请先在设置的 Fusion 页面选择 Lead 和 Worker', 'Open Settings → Fusion Next and choose a Lead and a Sidekick first'))
    const raw = saved?.value as Record<string, unknown> | undefined ?? loadJsonObject(config.profilePath!)
    const catalog = await physicalCatalog() ?? catalogFromRaw(raw)
    const pair = validatePairChoice(raw, catalog)
    const next = saved ? modelProfileFromChoice(pair) : raw
    defaultProfile = resolveProfile(next, next.interactionMode === 'model-like' ? loadModelPromptBundle() : loadPromptBundle(), { authorizedRoutes: catalog.groups.flatMap(group =>
      group.models.map(model => ({ provider: group.id, model: model.id }))) })
    return defaultProfile
  }
  let runtime: FusionCoordinator | undefined
  let creating: Promise<FusionCoordinator> | undefined
  const getRuntime = (frozen?: ResolvedProfile): Promise<FusionCoordinator> => {
    if (runtime) return Promise.resolve(runtime)
    if (creating) return creating
    creating = (async () => {
      const profile = frozen ?? (await configuredProfile())
      runtime = new FusionCoordinator(ctx, store, { profile, workerTools: config.workerTools ?? ['bash', 'pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_kill'] })
      return runtime
    })().finally(() => { creating = undefined })
    return creating
  }
  // The catalog entry admits what the configured Lead admits: the Lead is the
  // only role that reads user content, while the Worker receives text work
  // orders. The virtual entry also mirrors the Lead's declared contextWindow /
  // output cap / reasoning so host compaction can size the context.
  const leadModelInfo = async (): Promise<LlmResolvedModelInfo | undefined> => {
    try {
      const saved = store.readDocument('settings:profile')?.value
      const lead = savedLeadRoute(saved)
        ?? (config.profilePath && isAbsolute(config.profilePath) ? savedLeadRoute(loadJsonObject(config.profilePath)) : undefined)
      if (!lead) return undefined
      return await ctx.llm.resolveModelInfo(lead.provider, lead.model)
    } catch { return undefined }
  }
  // Virtual provider dispatch: the session/agent model state stays on
  // fusion-next/auto while every stream is delegated to the configured
  // Lead's physical adapter. The token meter observes both the fusion call and
  // the physical call (accounting duplicate until the dedicated Fusion LLM
  // layer replaces this delegation).
  // M5 (C2 tripwire): the catalog channel forwards read-class turns to the
  // worker with no lead-lane write gate — the un-audited-write hole confirmed
  // in M0. Latch a snapshot on forward, audit on idle, escalate on breach.
  const tripwire = createCatalogTripwire()
  const tripwireEnabled = (): boolean => {
    try { return (store.readDocument('settings:routing')?.value as { tripwire?: unknown } | undefined)?.tripwire !== false } catch { return true }
  }
  const fusionDispatch: FusionDispatch = (options: GenerateOptions, route: PhysicalRoute): AsyncIterable<StreamChunk> => {
    // A tripwire notice rides the escalated (lead-routed) turn: appended as a
    // trailing system message so the planner sees the audit beside the request.
    const notice = options.sessionId ? tripwire.takeNotice(String(options.sessionId)) : undefined
    return ctx.llm.stream({
      ...options,
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) }),
      ...(notice === undefined ? {} : {
        messages: [
          ...(options.messages ?? []),
          { role: 'system' as const, id: MessageId('fusion-tripwire-' + Date.now()), source: { kind: 'system-prompt' as const }, content: [{ type: 'text' as const, text: notice }] },
        ],
      }),
    })
  }
  // resolveLead: the configured global default, then the settings document,
  // then any selected session binding — a fresh install pairs per session
  // before a default profile exists, and the virtual selection still streams.
  const resolveFusionLead = (): PhysicalRoute | undefined => {
    if (defaultProfile?.profile.lead) return defaultProfile.profile.lead
    try {
      const saved = store.readDocument('settings:profile')?.value
      const lead = savedLeadRoute(saved)
      if (lead) return lead
      for (const binding of bindings.selected()) if (binding.profile.lead?.model) return binding.profile.lead
    } catch { /* a read failure leaves the soft-finish path in charge */ }
    return undefined
  }
  // Prefix routing: a paired session's newest user message decides which physical
  // model runs the whole turn. Clearly simple read/question turns go straight to
  // the paired executor — the cheap model does the reading and the expensive
  // model never wakes. Write intent, injected notices, and auxiliary calls stay on Lead.
  const WRITE_INTENT = /写|改|实现|创建|生成|开发|重构|修复|部署|安装|删除|更新|新增|添加|替换|编辑|做一|做个|优化|调整|跑|执行|运行|测试|提交|build|write|implement|create|fix|refactor|deploy|install|update|remove|edit|add|generat|change|delete|patch|commit|rename|move|make|optimi|test|run\b/i
  const READ_INTENT = /看|查|读|分析|解释|比较|列出|统计|找|搜索|梳理|总结|了解|哪里|什么|哪|几|多少|是否|有没有|为什么|怎么|grep|read|check|list|analy|explain|compare|find|search|show|describe|what|how|why|where|who|which|summar|review|trace|count|enum/i
  const NOTICE_SHAPE = /Fusion Next|fusion_next|fusion_dispatch|subagent|worker|后台|执行模型|Sidekick|settled|review-ready|exploration/i
  const INJECTED_SHAPE = /^\s*(Current runtime context|<system-reminder|<hindsight|\[MNEMON|MNEMON RUNTIME|<acp|<available_skills|USER\.md|MEMORY\.md|<skill_content|<context)/
  const userTextOf = (message: { content?: unknown } | undefined): string => (Array.isArray(message?.content) ? message.content as { type?: string; text?: string }[] : [])
    .filter(block => block?.type === 'text')
    .map(block => String(block.text ?? ''))
    .join(' ').trim()
  const lastRealUserText = (messages: readonly { role?: string; content?: unknown }[]): { text: string; fresh: boolean } => {
    let lastRealIndex = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role !== 'user') continue
      const text = userTextOf(message)
      if (text && !INJECTED_SHAPE.test(text) && !NOTICE_SHAPE.test(text)) { lastRealIndex = index; break }
    }
    if (lastRealIndex < 0) return { text: '', fresh: false }
    const fresh = !messages.slice(lastRealIndex + 1).some(message => message?.role === 'assistant')
    return { text: userTextOf(messages[lastRealIndex]), fresh }
  }
  const classifyUserText = (text: string): 'worker' | 'lead' => {
    if (!text) return 'lead'
    if (WRITE_INTENT.test(text)) return 'lead'
    if (NOTICE_SHAPE.test(text)) return 'lead'
    if (READ_INTENT.test(text) || text.length <= 600) return 'worker'
    return 'lead'
  }
  const resolveFusionRoute = (options?: GenerateOptions): PhysicalRoute | undefined => {
    const lead = resolveFusionLead()
    if (!options || options.purpose || !options.sessionId) return lead
    try {
      // A pending tripwire escalation wins over classification: the last
      // forwarded turn breached the audit, so the planner reviews it first.
      if (tripwire.escalate(String(options.sessionId))) return lead
      const binding = bindings.read(String(options.sessionId))?.binding
      const worker = binding?.selected ? binding.profile.worker : undefined
      if (!worker?.model) return lead
      const text = lastRealUserText(options.messages ?? []).text
      if (classifyUserText(text) === 'worker') {
        // Latch the pre-turn snapshot so the idle-time audit can attribute
        // every write this forwarded turn made (M5 C2, catalog channel only).
        if (tripwireEnabled()) {
          const root = ctx.agents.get(SessionId(String(options.sessionId)))?.session.header.cwd
          if (root) tripwire.latch(String(options.sessionId), root, text)
        }
        return worker
      }
      return lead
    } catch { return lead }
  }
  ctx.effect(() => ctx.llm.registerAdapter([FUSION_NEXT_PROVIDER], new FusionCatalogAdapter(leadModelInfo, fusionDispatch, resolveFusionRoute)))
  // Turn-end settle for the catalog tripwire: the audit is deterministic and
  // cheap (hash diff), and only a breach queues a lead-side escalation notice.
  ctx.effect(() => ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || agent.session.header.parentSession) return
    void tripwire.settle(agent.session.id)
  }))
  ctx.effect(() => ctx.on('agent/disposed', ({ agent }) => { tripwire.clear(agent.session.id) }))
  // Prefix routing on the physical path: pair sessions stream straight through
  // their physical adapter, so the llm/stream waterfall is the only seam that
  // sees every request. A clearly simple newest-user turn reroutes to the
  // paired executor — its sandbox/gates stay the Lead's, the planner never runs.
  const rerouted = new WeakSet<GenerateOptions>()
  const routeVerdicts = new Map<string, 'worker' | 'lead'>()
  const writeTurns = new Map<string, number>()
  const upgradeNoticed = new Set<string>()
  // M1 (B-arm probe): settings:routing doc { aggressiveWrite: true } switches the
  // judge to an aggressive variant that lets small in-workspace writes count as
  // SIMPLE. Default false — production classification is unchanged.
  const aggressiveWrite = (): boolean => {
    try { return Boolean((store.readDocument('settings:routing')?.value as { aggressiveWrite?: unknown } | undefined)?.aggressiveWrite) } catch { return false }
  }
  const judgeWithPlanner = async (route: PhysicalRoute, text: string): Promise<'worker' | 'lead'> => {
    const prompt = aggressiveWrite()
      ? [
          'Decide whether the newest user request can be fully handled by a cheaper junior executor.',
          'SIMPLE = read-only investigation, a short factual answer, OR a concrete in-workspace change the executor can finish alone — creating or editing files, running builds/tests, applying a clearly described fix — expected to touch at most a few files.',
          'COMPLEX = anything ambiguous, wide-blast-radius, destructive, or needing careful multi-step judgement and coordination.',
          'Answer with exactly one word: SIMPLE or COMPLEX. Request:',
          text.length > 4000 ? text.slice(0, 2000) + '\n…\n' + text.slice(-2000) : text,
        ].join('\n')
      : [
          'Decide whether the newest user request can be fully handled by a cheaper junior executor.',
          'SIMPLE = read-only investigation or a short factual answer (reading, searching, explaining, comparing, counting, summarising) with no file changes needed.',
          'COMPLEX = anything that writes, executes, fixes, builds, or needs careful multi-step judgement.',
          'Answer with exactly one word: SIMPLE or COMPLEX. Request:',
          text.length > 4000 ? text.slice(0, 2000) + '\n…\n' + text.slice(-2000) : text,
        ].join('\n')
    try {
      const judge: GenerateOptions = {
        provider: route.provider, model: route.model, maxTokens: 8,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        purpose: 'session-title' as GenerateOptions['purpose'],
      }
      rerouted.add(judge)
      let out = ''
      for await (const chunk of ctx.llm.stream(judge)) {
        if (chunk.type === 'text-delta') out += chunk.text
      }
      return /simple/i.test(out.trim()) ? 'worker' : 'lead'
    } catch { return 'lead' }
  }
  ctx.effect(() => ctx.on('llm/stream', async function* (request, next) {
    if (rerouted.has(request) || request.purpose || !request.sessionId) { yield* next(); return }
    const binding = bindings.read(String(request.sessionId))?.binding
    const worker = binding?.selected ? binding.profile.worker : undefined
    const lead = resolveFusionLead()
    if (!worker?.model || !lead?.model) { yield* next(); return }
    // A live dispatch means the Lead is orchestrating (reviews, reworks) —
    // those requests must never leave the planner.
    let busy = false
    try { busy = Boolean(binding?.taskId) && dispatchInFlight(store, binding!.taskId) } catch { busy = true }
    if (busy) { yield* next(); return }
    const { text, fresh } = lastRealUserText(request.messages ?? [])
    if (!text) { yield* next(); return }
    const verdictKey = String(request.sessionId) + ':' + text.slice(0, 500)
    let verdict = routeVerdicts.get(verdictKey)
    if (!verdict) {
      if (!fresh) { yield* next(); return }
      // M3: write intent goes to the Lead directly — no per-turn judge tax on
      // writes. Only read-class and short text reach the judge (SIMPLE→worker),
      // unless the M1 aggressiveWrite probe is on.
      const cls = classifyUserText(text)
      const sid = String(request.sessionId)
      if (cls === 'lead' && !aggressiveWrite()) {
        const turns = (writeTurns.get(sid) ?? 0) + 1
        writeTurns.set(sid, turns)
        if (turns >= 2 && !upgradeNoticed.has(sid)) {
          upgradeNoticed.add(sid)
          const notice: GenerateOptions = {
            ...request,
            messages: [
              ...(request.messages ?? []).slice(0, -1),
              { role: 'system' as const, id: MessageId(`fusion-upgrade-${Date.now()}`), source: { kind: 'system-prompt' as const }, content: [{ type: 'text' as const, text: '[fusion-next] This task looks substantive and multi-turn — consider binding the pair with /fusion-next to get plan-once dispatch, audit bundles, and bounded rework. (Catalog channel: write turns stay on the planner model.)' }] },
              ...(request.messages ?? []).slice(-1),
            ],
          }
          rerouted.add(notice)
          yield* ctx.llm.stream(notice)
          return
        }
        yield* next(); return
      }
      if (cls === 'worker') writeTurns.set(sid, 0)
      verdict = await judgeWithPlanner(worker ?? lead, text)
      routeVerdicts.set(verdictKey, verdict)
    }
    if (verdict !== 'worker') { yield* next(); return }
    const forward: GenerateOptions = { ...request, provider: worker.provider, model: worker.model, reasoningEffort: undefined }
    rerouted.add(forward)
    yield* ctx.llm.stream(forward)
  }, { prepend: true }))
  // Session-pair seam (composer dual pickers): the session's physical host
  // selection is the planner; the dock picker persists the executor here.
  const workerOf = (sessionId: string): PhysicalRoute | undefined => readSessionPair(store, sessionId)?.pair.worker
  const leadChanged = (sessionId: string, lead: PhysicalRoute): void => { syncSessionPairLead(store, sessionId, lead) }
  const sessionProfile = (_sessionId: string, lead: PhysicalRoute, worker: PhysicalRoute): ResolvedProfile => {
    const base = defaultProfile
    if (base) {
      // Preserve the operator's configured context/cache/compaction policy;
      // only the two routes come from the session pickers.
      return { profile: completeProfile({ ...base.profile, lead, worker }, base.prompts), prompts: base.prompts }
    }
    const prompts = loadModelPromptBundle()
    return resolveProfile(modelProfileFromChoice({ lead, worker } as Parameters<typeof modelProfileFromChoice>[0]), prompts,
      { authorizedRoutes: [lead, worker] })
  }
  ctx.effect(() => installNativeFusionSelection(ctx, {
    coordinator: () => runtime, profile: () => defaultProfile,
    workerOf, sessionProfile, leadChanged,
    ensureCoordinator: async (_sessionId, lead, worker) => { await getRuntime(sessionProfile(_sessionId, lead, worker)) },
    selection: agent => {
      const selection = agent.session.snapshotEvents().findLast(event => event.type === 'model/selection')
      if (selection?.type === 'model/selection') return selection.data
      if (bindings.read(agent.id)?.binding.selected) return { provider: FUSION_NEXT_PROVIDER, model: FUSION_NEXT_MODEL }
      const header = agent.session.requestHeader()
      return header ? { provider: header.config.provider, model: header.config.model } : ctx.agentDefaultModel.currentSelection()
    },
  }))
  // Frozen bindings must be restored before another user request is allowed.
  const restoreFailure = new Map<string, string>()
  ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
    const binding = bindings.read(payload.agent.id)?.binding
    if (!binding?.selected) return next()
    try { await getRuntime({ profile: binding.profile, prompts: binding.prompts }); if (restoreFailure.has(payload.agent.id)) restoreFailure.delete(payload.agent.id) }
    catch (error) { restoreFailure.set(payload.agent.id, String(error)); return { kind: 'reject' as const } }
    return next()
  }, { prepend: true }))
  // webServer may arrive after apply() (web bundle starts late) — inject defers
  // registration until the service exists and re-registers on replacement.
  ctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.get('webServer')!.register({ kind: 'exact', path: '/api/fusion-next', handler: async (req, res) => {
    if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET') {
        if (url.searchParams.get('view') === 'history') return json(res, 200, readHistory(store, url.searchParams.get('cursor') ?? ''))
        if (url.searchParams.get('view') === 'scorecard') return json(res, 200, readScorecard(store,
          Number(url.searchParams.get('limit') ?? '50')))
        if (url.searchParams.get('view') === 'activity') return json(res, 200, await readHistoricalFusionActivity(ctx, store,
          url.searchParams.get('sessionId') ?? '', url.searchParams.get('callId') ?? '', Number(url.searchParams.get('after') ?? -1)))
        if (url.searchParams.get('view') === 'status') {
          const abort = new AbortController(), disconnected = () => abort.abort()
          res.once('close', disconnected)
          try {
            const status = await readFusionStatusAsync(store, url.searchParams.get('sessionId') ?? '', abort.signal)
            if (!res.destroyed) return json(res, 200, status)
            return
          } catch (error) { if (!abort.signal.aborted) throw error; return }
          finally { res.off('close', disconnected) }
        }
        if (url.searchParams.get('view') === 'catalog') return json(res, 200, await ctx.get('sessionController')?.modelCatalog() ?? { groups: [] })
        if (url.searchParams.get('view') === 'session-pair') {
          const sid = url.searchParams.get('sessionId') ?? ''
          const pair = sid ? readSessionPair(store, sid)?.pair : undefined
          const bound = sid ? bindings.read(sid)?.binding : undefined
          const intent = sid ? store.readDocument('sandbox-intent:' + sid)?.value as { mode?: string } | undefined : undefined
          return json(res, 200, { worker: pair?.worker ?? null, lead: pair?.lead ?? null,
            selected: Boolean(bound?.selected), executorMode: intent?.mode ?? null,
            catalog: await physicalCatalog() })
        }
        if (url.searchParams.get('view') === 'session-usage') {
          const sid = url.searchParams.get('sessionId') ?? ''
          const binding = sid ? bindings.read(sid)?.binding : undefined
          const empty = { input: 0, output: 0, cacheRead: 0, calls: 0 }
          const totals: Record<string, { input: number; output: number; cacheRead: number; calls: number }> = {}
          const models: Record<string, { input: number; output: number; cacheRead: number; calls: number; role: string }> = {}
          const total = { ...empty }
          if (binding) {
            for (const id of store.listDocumentIds('usage-index:' + binding.taskId + ':')) {
              const row = store.readDocument(id)?.value as UsageSummary | undefined
              if (!row || row.taskId !== binding.taskId) continue
              const role = row.role || 'lead'
              const bucket = totals[role] ?? (totals[role] = { ...empty })
              const modelKey = row.provider + '/' + row.model
              const mb = models[modelKey] ?? (models[modelKey] = { ...empty, role })
              for (const key of ['input', 'output', 'cacheRead'] as const) {
                const count = row[key]
                if (count?.state === 'known') { bucket[key] += count.tokens; mb[key] += count.tokens; total[key] += count.tokens }
              }
              bucket.calls++; mb.calls++; total.calls++
            }
          }
          const inputTotal = total.input + total.cacheRead
          return json(res, 200, { paired: Boolean(binding?.selected), roles: totals, models, total,
            cacheHit: inputTotal > 0 ? total.cacheRead / inputTotal : null })
        }
        if (url.searchParams.get('view') === 'running') {
          const abort = new AbortController(), disconnected = () => abort.abort()
          res.once('close', disconnected)
          try {
            const sessions = await Promise.all(bindings.selected().map(async binding => {
              let title: string | null = null
              try {
                title = (ctx.agents.get(SessionId(binding.sessionId))?.session.snapshotEvents()
                  .findLast(event => event.type === 'session/title') as { title?: string } | undefined)?.title ?? null
              } catch { title = null }
              const status = await readFusionStatusAsync(store, binding.sessionId, abort.signal)
              return { sessionId: binding.sessionId, title,
                lead: binding.profile.lead, worker: binding.profile.worker, task: status.task ?? null }
            }))
            if (!res.destroyed) return json(res, 200, { sessions })
            return
          } catch (error) { if (!abort.signal.aborted) throw error; return }
          finally { res.off('close', disconnected) }
        }
        if (url.searchParams.get('view') === 'cache') {
          let profile: ResolvedProfile | undefined
          try { profile = await configuredProfile() } catch { profile = undefined }
          return json(res, 200, { checked: CACHE_DEFAULTS_CHECKED, models: cacheView(cachePolicy,
            profile ? { lead: profile.profile.lead, worker: profile.profile.worker } : undefined, profile?.profile.cacheKeepalive) })
        }
        if (url.searchParams.get('view') === 'settings') {
          const saved = store.readDocument('settings:profile')
          let profile: ResolvedProfile | undefined, reason: string | undefined
          try { profile = await configuredProfile() } catch (error) { reason = error instanceof Error ? error.message : String(error) }
          return json(res, 200, { revision: saved?.revision ?? 0, catalog: await physicalCatalog(),
            pair: profile ? choiceFromProfile(profile.profile) : null,
            authorized: true, reason, managedAuthorization: false, policy: profile?.profile.interactionMode ?? 'legacy', actualBilledUsd: null, apiEquivalentUsd: null })
        }
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const binding = sessionId && bindings.read(sessionId)?.binding
        let available = false, reason: string | undefined
        try {
          const profile = binding && binding.selected ? { profile: binding.profile, prompts: binding.prompts } : await configuredProfile()
          const controller = await getRuntime(profile)
          controller.transport.assertAvailable()
          available = true
        } catch (error) { reason = error instanceof Error ? error.message : String(error) }
        const status = binding ? readFusionStatus(store, sessionId) : undefined
        return json(res, 200, { selected: Boolean(binding && binding.selected), available, ...(reason ? { reason } : {}),
          ...(status?.task ? { task: status.task } : {}) })
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      const body = await readJson(req)
      if (['continue', 'switch-role', 'schedule', 'cancel-schedule'].includes(String(body.action))) {
        // The v0.3 pair has no scheduled-continue surface; recover through /fusion-next recover.
        throw new Error(bi('v0.3 移除了定时/切换恢复 — 用 /fusion-next recover 提交检查记录，或用 /fusion-next resume 继续。',
          'v0.3 removed scheduled/switch recovery — use /fusion-next recover with an inspection note, or /fusion-next resume.'))
      }
      if (body.action === 'authorize') {
        throw new Error(bi('v0.3 移除了额度授权文件 — 模型限额由宿主侧管理。', 'v0.3 removed the authorization file — model limits are host-managed.'))
      }
      if (body.action === 'cache-setting') {
        if (typeof body.provider !== 'string' || typeof body.model !== 'string' || !body.provider || !body.model) throw new Error(bi('请选择模型', 'Choose a model'))
        const setting = body.reset === true ? null : {
          ...(body.mode === undefined || body.mode === null ? {} : { mode: body.mode as 'auto' | 'on' | 'off' }),
          ...(body.intervalSeconds === undefined || body.intervalSeconds === null ? {} : { intervalSeconds: Number(body.intervalSeconds) }) }
        cachePolicy.save(body.provider, body.model, setting)
        return json(res, 200, { ok: true })
      }
      if (body.action === 'configure') {
        if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new Error(bi('配置版本无效，请刷新后重试', 'Invalid settings revision; refresh and retry'))
        const pair = validatePairChoice(body.pair, await physicalCatalog() ?? catalogFromRaw(body.pair as Record<string, unknown>))
        const revision = store.writeDocument('settings:profile', Number(body.revision), modelProfileFromChoice(pair))
        const profile = await configuredProfile()
        await getRuntime(profile)
        return json(res, 200, { ok: true, revision })
      }
      if (body.action === 'session-pair') {
        if (typeof body.sessionId !== 'string' || !body.sessionId) throw new Error(bi('会话参数无效', 'Invalid session id'))
        const sessionId = body.sessionId
        const prior = readSessionPair(store, sessionId)
        if (body.worker === null) {
          writeSessionPair(store, sessionId, prior?.revision ?? 0,
            { schemaVersion: 1, ...(prior?.pair ?? {}), worker: undefined })
          const binding = bindings.read(sessionId)?.binding
          if (binding?.selected) {
            const agent = ctx.agents.get(SessionId(sessionId))
            const controller = await getRuntime({ profile: binding.profile, prompts: binding.prompts })
            if (agent) { if (agent.status !== 'idle') await controller.pause(agent); await controller.clear(agent, { abandon: body.force === true }) }
            else bindings.clear(sessionId)
          }
          return json(res, 200, { ok: true, selected: false })
        }
        const candidate = body.worker as { provider?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined
        if (!candidate || typeof candidate.provider !== 'string' || !candidate.provider
          || candidate.provider === FUSION_NEXT_PROVIDER || typeof candidate.model !== 'string' || !candidate.model) {
          throw new Error(bi('执行模型必须是一个真实模型', 'The executor must be a real model'))
        }
        const catalog = await physicalCatalog() ?? catalogFromRaw({ worker: candidate })
        const model = catalog.groups.find(group => group.id === candidate.provider)?.models.find(item => item.id === candidate.model)
        if (!model) throw new Error(bi('执行模型已不可用，请刷新后重选', 'The executor model is no longer available; refresh and choose again'))
        if (candidate.reasoningEffort !== undefined && candidate.reasoningEffort !== null
          && (typeof candidate.reasoningEffort !== 'string'
            || !model.reasoning?.efforts.some(effort => effort.id === candidate.reasoningEffort))) {
          throw new Error(bi('执行模型不支持所选推理强度', 'The executor does not support the selected reasoning level'))
        }
        const worker: PhysicalRoute = { provider: candidate.provider, model: candidate.model,
          ...(typeof candidate.reasoningEffort === 'string' ? { reasoningEffort: candidate.reasoningEffort } : {}) }
        writeSessionPair(store, sessionId, prior?.revision ?? 0,
          { schemaVersion: 1, ...(prior?.pair ?? {}), worker })
        return json(res, 200, { ok: true, worker })
      }
      throw new Error(bi('请使用原模型菜单选择 Fusion 或切换普通模型', 'Use the model menu to select Fusion or another model'))
    } catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : String(error) }) }
  } })))
  ctx.effect(() => ctx.commands.register({ name: 'fusion-next', description: bi('Fusion 状态、暂停、恢复与退出（不调用模型）', 'Fusion status, pause, resume and exit (no model call)'),
    input: { hint: bi('status | pair [<provider>/]<model> | pair off [--force] | pause | resume | recover [--effects-stopped] <检查记录> | off [--force]', 'status | pair [<provider>/]<model> | pair off [--force] | pause | resume | recover [--effects-stopped] <inspection note> | off [--force]') },
    handler: async invocation => {
      const [action = 'status', ...note] = invocation.rawInput.trim().split(/\s+/)
      try {
        if (action === 'pair') {
          const sessionId = invocation.agent.id
          const prior = readSessionPair(store, sessionId)
          const target = note[0]
          if (!target) {
            const pair = prior?.pair
            if (!pair?.worker)
              return { kind: 'success', text: bi('本会话未设定执行模型。用 /fusion-next pair [<provider>/]<model> 设定，pair off 退出。', 'No executor set. Use /fusion-next pair [<provider>/]<model> to set one, pair off to exit.') }
            const intentMode = (store.readDocument('sandbox-intent:' + sessionId)?.value as { mode?: string } | undefined)?.mode
            const modeText = intentMode ? bi('，执行权限 ' + intentMode, ', executor mode ' + intentMode) : ''
            return { kind: 'success', text: bi('本会话执行模型：' + pair.worker.provider + '/' + pair.worker.model + '（规划 ' + (pair.lead?.provider ?? '?') + '/' + (pair.lead?.model ?? '?') + '）' + modeText + '。', 'Executor: ' + pair.worker.provider + '/' + pair.worker.model + ' (planner ' + (pair.lead?.provider ?? '?') + '/' + (pair.lead?.model ?? '?') + ')' + modeText + '.') }
          }
          if (target === 'off' || target === 'none') {
            writeSessionPair(store, sessionId, prior?.revision ?? 0,
              { schemaVersion: 1, ...(prior?.pair ?? {}), worker: undefined })
            const pairBinding = bindings.read(sessionId)?.binding
            if (pairBinding?.selected) {
              const controller = await getRuntime({ profile: pairBinding.profile, prompts: pairBinding.prompts })
              if (invocation.agent.status !== 'idle') await controller.pause(invocation.agent)
              await controller.clear(invocation.agent, { abandon: note.includes('--force') })
            }
            return { kind: 'success', text: bi('本会话已退出 Fusion 编队，恢复为普通会话。', 'Fusion pair cleared; this session is a normal conversation again.') }
          }
          const catalog = await physicalCatalog() ?? { groups: [] }
          const entries = catalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model })))
          const match = note[1]
            ? entries.find(entry => entry.provider === note[0] && entry.model.id === note[1])
            : entries.find(entry => entry.model.id === target)
              ?? entries.find(entry => {
                const slash = target.indexOf('/')
                return slash > 0 && entry.provider === target.slice(0, slash) && entry.model.id === target.slice(slash + 1)
              })
          if (!match) throw new Error(bi('执行模型 ' + target + ' 不可用；请查看模型目录。', 'Executor model ' + target + ' is not available; check the model catalog.'))
          const worker: PhysicalRoute = { provider: match.provider, model: match.model.id }
          writeSessionPair(store, sessionId, prior?.revision ?? 0,
            { schemaVersion: 1, ...(prior?.pair ?? {}), worker })
          return { kind: 'success', text: bi('已为会话设定执行模型 ' + match.provider + '/' + match.model.id + '。发送下一条消息即按编队执行。', 'Executor set to ' + match.provider + '/' + match.model.id + '. The next message runs as a Fusion pair.') }
        }
        const binding = bindings.read(invocation.agent.id)?.binding
        if (!binding?.selected) return { kind: 'success', text: bi('当前会话未启用 Fusion。请在模型选择器中选择 Fusion Next · 自动。', 'Fusion is not selected in this conversation. Choose Fusion · auto in the model menu.') }
        const controller = await getRuntime({ profile: binding.profile, prompts: binding.prompts })
        if (action === 'status' || action === '') {
          const runtime = controller.state(binding.taskId)
          const unfinishedEffects = controller.effects.pending(binding.taskId).map(({ record }) => ({ role: record.role, tool: record.toolName }))
          const usageCalls = store.listDocumentIds('usage-index:' + binding.taskId + ':').length
          return { kind: 'success', text: JSON.stringify({ taskId: binding.taskId,
            paused: runtime?.paused ?? null, cleared: runtime?.cleared ?? null,
            workerId: runtime?.worker?.childId ?? binding.workerId ?? null,
            dispatches: runtime?.dispatches.slice(-6) ?? [],
            modelCalls: usageCalls, unfinishedEffects,
            ...(unfinishedEffects.length ? { recoveryHint: bi('请核对中断的工具操作，确认对应命令及子进程已停止；Host 退出不代表这些操作已结束。', 'Check the interrupted tool operations and confirm their commands and child processes stopped; a Host exit does not end them.') } : {}),
            actualBilledUsd: null, apiEquivalentUsd: null }, null, 2) }
        }
        if (action === 'pause') await controller.pause(invocation.agent)
        else if (action === 'resume') await controller.resume(invocation.agent)
        else if (action === 'recover') await controller.reconcile(invocation.agent, { commandId: invocation.commandId,
          effectsStopped: note[0] === '--effects-stopped', note: (note[0] === '--effects-stopped' ? note.slice(1) : note).join(' ') })
        else if (action === 'off') {
          await controller.clear(invocation.agent, { abandon: note.includes('--force') })
          await ctx.get('sessionController')?.selectModel({ sessionId: SessionId(invocation.agent.id), ...binding.profile.lead })
        }
        else throw new Error(bi('使用 /fusion-next status、pause、resume、recover <检查记录> 或 off', 'Use /fusion-next status, pause, resume, recover <inspection note> or off'))
        return { kind: 'success', text: action === 'resume'
          ? bi('Fusion 已恢复。发送下一条消息继续当前任务。', 'Fusion resumed. Send a message to continue the task.')
          : bi('Fusion ' + action + ' 已完成。', 'Fusion ' + action + ' done.') }
      } catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) } }
    } }))
  ctx.effect(() => async () => { if (creating) await creating.catch(() => undefined); if (runtime) await runtime.close(); store.close() })
  // Warm only configuration/scopes; initialization performs no inference.
  try { await getRuntime(await configuredProfile()) }
  catch {
    const selected = bindings.selected()[0]
    if (selected) await getRuntime({ profile: selected.profile, prompts: selected.prompts })
  }
  ctx.logger.info('[my-plugins/fusion-next] loaded (v0.3 single-dispatch)')
}
