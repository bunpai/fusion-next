import { bi } from './bilingual.js'
import { backfillHistory, readHistory, readScorecard, type UsageSummary } from './host/history.js'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, LlmResolvedModelInfo, ModelModality, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { FusionCatalogAdapter, FUSION_NEXT_PROVIDER, FUSION_NEXT_MODEL, installNativeFusionSelection, type FusionDispatch } from './host/native-selection.js'
import type { PhysicalRoute } from './contracts.js'
import type { ResolvedProfile } from './profile/resolve.js'
import { choiceFromProfile, modelProfileFromChoice, validatePairChoice, savedLeadRoute } from './host/settings.js'
import { CachePolicy, cacheView } from './host/cache-policy.js'
import { CACHE_DEFAULTS_CHECKED } from './host/cache-defaults.js'
import { loadJsonObject, resolveProfile, completeProfile } from './profile/resolve.js'
import { profileRoutes } from './profile/compactor.js'
import { loadModelPromptBundle, loadPromptBundle } from './prompts.js'
import { SqliteFusionStore } from './task/sqlite-store.js'
import { BindingRepository, type SessionBinding } from './host/bindings.js'
import { FusionCoordinator } from './host/coordinator.js'
import { authorizeConfiguredPair, NativeRequestBudget } from './host/native-budget.js'
import { json, readJson, trustedRequest } from './host/http.js'
import { readFusionStatusAsync } from './host/status.js'
import { readHistoricalFusionActivity } from './host/native-activity.js'
import { nativeShellTool } from './host/shell.js'
import { migrateFusionV2 } from './persistence/index.js'
import { openRunManager, type RunManager } from './run-manager/index.js'
import { SessionLifecycle } from './session/lifecycle.js'
import { SessionSuspension } from './session/suspension.js'
import { EffectLedger } from './effects/ledger.js'
import { probeHostCapabilities } from './host-capabilities/index.js'
import { V2Shadow } from './host/v2-shadow.js'
import { readSessionPair, writeSessionPair, syncSessionPairLead } from './host/session-pair.js'

export * from './index.js'

export const name = 'fusion-next'
export const inject = ['agents', 'sessions', 'llm', 'tools', 'subagents', 'systemPrompt', 'webServer', 'sessionController', 'sessionQuery', 'commands', 'agentDefaultModel', 'tokenMeter']
export interface Config { profilePath?: string; authorizationPath?: string; databasePath?: string; workerTools?: string[]; lifecycleBridge?: boolean; hostSdkVersion?: string; fusionDatabasePath?: string; leadSandbox?: boolean; workerPolicy?: 'inherit' | 'restricted' }
const defaultWorkerTools = [nativeShellTool, 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_kill']
// Schemastery otherwise normalizes an omitted array to [], bypassing ?? below.
// An explicitly empty list must remain empty, so the default belongs in the schema.
export const Config: z<Config> = z.object({ profilePath: z.string(), authorizationPath: z.string(), databasePath: z.string(),
  workerTools: z.array(z.string()).default(defaultWorkerTools),
  lifecycleBridge: z.boolean().default(false), hostSdkVersion: z.string(), fusionDatabasePath: z.string(),
  leadSandbox: z.boolean().default(true),
  workerPolicy: z.union([z.const('inherit' as const), z.const('restricted' as const)]).default('inherit' as const) })

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const database = config.databasePath || join(dshHome, 'plugins', name, 'state.sqlite')
  if (!isAbsolute(database)) throw new Error('Fusion databasePath must be absolute')
  const store = new SqliteFusionStore(database), bindings = new BindingRepository(store)
  // ---- B01–C01 lifecycle bridge (journal-backed Fusion activation) ------------
  // The B02/B03 stack keeps its own additive v2 journal next to the legacy task
  // store. Migration is explicit and idempotent; opening never migrates.
  const fusionDatabase = config.fusionDatabasePath || join(dshHome, 'plugins', name, 'fusion-v2.sqlite')
  if (!isAbsolute(fusionDatabase)) throw new Error('Fusion fusionDatabasePath must be absolute')
  let lifecycleManager: RunManager | undefined
  const capabilityReport = () => {
    // Default is fail-closed: this plugin cannot certify Host fork/rebind
    // semantics from the inside, so every mutation is denied with an explicit
    // version error. lifecycleBridge=true records an explicit OPERATOR
    // attestation for an unlisted Host version (caller-supplied, never
    // host-certified; the rc.2 fence stays intact).
    const attested = config.lifecycleBridge === true
    return probeHostCapabilities({
      sdkVersion: config.hostSdkVersion,
      attested: attested || undefined,
      observed: attested
        ? {
            sessionRead: true, sessionFork: true, forkLineage: true,
            sessionRebind: true, rebindAtomic: true,
            lifecycleEvents: true, lifecycleOrdering: true,
            approvalRequest: true, approvalTurnOpen: true,
            compactionControl: true, compactionTransaction: true,
            effectObservation: true, effectOutcomeKnown: true, effectIdempotency: true,
          }
        : {},
    })
  }
  const fusionLifecycle = (): SessionLifecycle => {
    if (!lifecycleManager) {
      migrateFusionV2(fusionDatabase)
      lifecycleManager = openRunManager(fusionDatabase)
    }
    return new SessionLifecycle(lifecycleManager, capabilityReport())
  }
  const appliedPhysicalRoutes = new Map<string, { provider: string; model: string }>()
  // Lazy v2 shadow: created on first live task event once the v2 journal is open.
  let v2Shadow: V2Shadow | undefined
  const shadow = (): V2Shadow => {
    if (!v2Shadow) {
      migrateFusionV2(fusionDatabase)
      lifecycleManager = openRunManager(fusionDatabase)
      v2Shadow = new V2Shadow(lifecycleManager, store, () => defaultProfile)
    }
    return v2Shadow
  }
  const fusionSuspension = (): SessionSuspension => {
    if (!lifecycleManager) {
      migrateFusionV2(fusionDatabase)
      lifecycleManager = openRunManager(fusionDatabase)
    }
    return new SessionSuspension(lifecycleManager, new EffectLedger(lifecycleManager), capabilityReport(), fusionLifecycle())
  }
  const fusionActivate = (sessionId: string): void => {
    // Deterministic per-session identities keep activation idempotent: an exact
    // retry collapses into the already-committed journal events instead of
    // duplicating runs, and any divergent interleaving fails the per-run CAS.
    if (!lifecycleManager) {
      migrateFusionV2(fusionDatabase)
      lifecycleManager = openRunManager(fusionDatabase)
    }
    // Status-aware intent (S04): a SUSPENDED run must take the restore path;
    // passing create on a suspended run is a conflict by reducer contract.
    const alias = lifecycleManager.getAlias(SessionId(sessionId) as never)
    const run = alias ? lifecycleManager.getRun(alias.runId) : undefined
    const intent = run?.status === 'SUSPENDED'
      ? { kind: 'restore' as const }
      : { kind: 'create' as const, taskId: `fusion-task-${sessionId}`, budgetId: `fusion-budget-${sessionId}`, mode: 'DIRECT' as const }
    fusionLifecycle().activate(sessionId, intent)
  }
  const fusionSuspend = (sessionId: string): void => {
    const outcome = fusionSuspension().suspend(SessionId(sessionId) as never)
    if (!outcome.suspended && !outcome.alreadySuspended && outcome.bound && outcome.blockers.length > 0) {
      // Physical truth wins: coordinator.pause() is unconditional user intent,
      // so journal the suspend even when the service policy reports blockers —
      // the run IS suspended on the Host. Blockers stay visible in the log.
      console.warn(`[fusion-next] suspend journaled despite blockers for ${sessionId}: ${outcome.blockers.join(', ')}`)
      const manager = lifecycleManager!
      const alias = manager.getAlias(SessionId(sessionId) as never)
      const run = alias ? manager.getRun(alias.runId) : undefined
      if (run && run.status === 'RUNNING') {
        const revision = run.revision
        manager.append({ schemaVersion: 1, eventId: `fusion/suspend-requested/${run.id}/r${revision}`,
          type: 'RUN_SUSPEND_REQUESTED', runId: run.id } as never, revision)
        manager.append({ schemaVersion: 1, eventId: `fusion/suspended/${run.id}/r${revision + 1}`,
          type: 'RUN_SUSPENDED', runId: run.id } as never, revision + 1)
      }
    }
  }
  const cachePolicy = new CachePolicy(store)
  backfillHistory(store)
  const budget = new NativeRequestBudget(store, config.authorizationPath)
  let defaultProfile: ResolvedProfile | undefined
  const physicalCatalog = async () => {
    const catalog = await ctx.sessionController.modelCatalog()
    return { ...catalog, groups: catalog.groups.filter(group => group.id !== FUSION_NEXT_PROVIDER) }
  }
  const configuredProfile = async (): Promise<ResolvedProfile> => {
    defaultProfile = undefined
    const saved = store.readDocument('settings:profile')
    if (!saved && (!config.profilePath || !isAbsolute(config.profilePath))) throw new Error(bi('请先在设置的 Fusion 页面选择 Lead 和 Worker', 'Open Settings → Fusion Next and choose a Lead and a Sidekick first'))
    const raw = saved?.value as Record<string, unknown> | undefined ?? loadJsonObject(config.profilePath!)
    const catalog = await physicalCatalog()
    const pair = validatePairChoice(raw, catalog)
    const next = saved ? modelProfileFromChoice(pair) : raw
    defaultProfile = resolveProfile(next, next.interactionMode === 'model-like' ? loadModelPromptBundle() : loadPromptBundle(), { authorizedRoutes: catalog.groups.flatMap(group =>
      group.models.map(model => ({ provider: group.id, model: model.id }))) })
    return defaultProfile
  }
  const needsBudget = (profile: ResolvedProfile['profile']) => Boolean(config.authorizationPath) || profile.interactionMode !== 'model-like'
  let runtime: FusionCoordinator | undefined
  const effectiveRoutes = (binding: SessionBinding) => profileRoutes({ ...binding.profile,
    lead: runtime?.modelControl.route(binding, 'lead') ?? binding.profile.lead,
    worker: runtime?.modelControl.route(binding, 'worker') ?? binding.profile.worker })
  // Session-pair seam (composer dual pickers): the session's physical host
  // selection is the planner; the dock picker persists the executor here.
  const workerOf = (sessionId: string): PhysicalRoute | undefined =>
    readSessionPair(store, sessionId)?.pair.worker
  const leadChanged = (sessionId: string, lead: PhysicalRoute): void =>
    syncSessionPairLead(store, sessionId, lead)
  const sessionRoutes = (sessionId: string) => readSessionPair(store, sessionId)?.pair
  const sessionProfile = (_sessionId: string, lead: PhysicalRoute, worker: PhysicalRoute): ResolvedProfile => {
    const base = defaultProfile
    if (base) {
      // Preserve the operator's configured context/cache/compaction policy;
      // only the two routes come from the session pickers.
      return { profile: completeProfile({ ...base.profile, lead, worker }, base.prompts), prompts: base.prompts }
    }
    const prompts = loadModelPromptBundle()
    return { profile: completeProfile(modelProfileFromChoice({ lead, worker }), prompts), prompts }
  }
  let creating: Promise<FusionCoordinator> | undefined
  const getRuntime = (frozen?: ResolvedProfile): Promise<FusionCoordinator> => {
    if (runtime) return Promise.resolve(runtime)
    if (creating) return creating
    creating = (async () => {
      const profile = frozen ?? await configuredProfile()
      runtime = new FusionCoordinator(ctx, store, { profile, workerTools: config.workerTools ?? defaultWorkerTools,
        leadSandbox: config.leadSandbox, workerPolicy: config.workerPolicy,
        onPhysicalRouteSelected: (agentId, route) => appliedPhysicalRoutes.set(agentId, route),
        sessionRoutes,
        onTaskEvent: (taskId, type, payload) => { try { shadow().handle(taskId, type, payload) } catch { /* shadow is non-fatal */ } },
        // S19 cross-branch write conflicts: a path claimed by another run's open
        // assignment (journaled by the shadow) is denied at the write-lease gate.
        fileConflicts: (binding, path) => {
          try {
            if (!lifecycleManager) {
              migrateFusionV2(fusionDatabase)
              lifecycleManager = openRunManager(fusionDatabase)
            }
            const parent = store.load(binding.taskId)?.parent
            if (typeof parent !== 'string' || parent.length === 0) return undefined
            const runId = `fusion-run-${parent}`
            for (const assignment of Object.values(lifecycleManager.getState().assignments)) {
              if (assignment.status !== 'OPEN' && assignment.status !== 'TAKEN_OVER') continue
              if (String(assignment.runId) === runId) continue
              for (const claim of assignment.claimedPaths) {
                const covered = claim === path || (claim.endsWith('/') ? path.startsWith(claim) : path.startsWith(`${claim}/`))
                if (covered) return `FUSION_NEXT_FILE_CONFLICT: ${path} is claimed by assignment ${assignment.assignmentId} on a sibling branch (${assignment.runId}); coordinate through the Lead instead of writing there`
              }
            }
          } catch { /* a claim-lookup failure must not silently widen writes */ }
          return undefined
        },
        resumeAuthorization: binding => needsBudget(binding.profile) ? budget.check(effectiveRoutes(binding)).authorizationId : 'native-account',
        authorizeRequest: (_agent, binding) => {
          if (!needsBudget(binding.profile)) return
          try { budget.check(effectiveRoutes(binding)) }
          catch (error) {
            const state = store.load(binding.taskId)
            if (state?.control.mode === 'running' && !state.control.budgetBlocked) runtime?.append(binding.taskId, 'budget/blocked', { reason: String(error) })
            throw error
          }
        },
        reserveRequest: (request, binding) => {
          if (!needsBudget(binding.profile)) return
          try { budget.reserve({ provider: request.provider, model: request.model }, request.maxTokens ?? 0) }
          catch (error) {
            const state = store.load(binding.taskId)
            if (state?.control.mode === 'running' && !state.control.budgetBlocked) runtime?.append(binding.taskId, 'budget/blocked', { reason: String(error) })
            throw error
          }
        } })
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
    } catch {
      // An unresolvable Lead route (unregistered provider, retired model, broken
      // profile file) leaves the catalog entry text-only with no disclosed window.
      return undefined
    }
  }
  // Virtual provider dispatch: the session/agent model state stays on
  // fusion-next/auto while every stream is delegated to the configured
  // Lead's physical adapter. The token meter observes both the fusion call and
  // the physical call (accounting duplicate until the dedicated Fusion LLM
  // layer replaces this delegation).
  const fusionDispatch: FusionDispatch = (options: GenerateOptions, route: PhysicalRoute): AsyncIterable<StreamChunk> => ctx.llm.stream({
    ...options,
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) }),
  })
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
  // the paired executor — the Lead's read-only sandbox already fences its tools,
  // so the cheap model does the reading and the expensive model never wakes.
  // Write intent, injected notices, and auxiliary calls (purpose) stay on Lead.
  const WRITE_INTENT = /写|改|实现|创建|生成|开发|重构|修复|部署|安装|删除|更新|新增|添加|替换|编辑|做一|做个|优化|调整|跑|执行|运行|测试|提交|build|write|implement|create|fix|refactor|deploy|install|update|remove|edit|add|generat|change|delete|patch|commit|rename|move|make|optimi|test|run\b/i
  const READ_INTENT = /看|查|读|分析|解释|比较|列出|统计|找|搜索|梳理|总结|了解|哪里|什么|哪|几|多少|是否|有没有|为什么|怎么|grep|read|check|list|analy|explain|compare|find|search|show|describe|what|how|why|where|who|which|summar|review|trace|count|enum/i
  const NOTICE_SHAPE = /Fusion Next|fusion_next|subagent|worker|后台|执行模型|Sidekick|settled|review-ready|exploration/i
  // Injected host/plugin context lands as role:'user' messages around the real
  // input — skip them when picking the message to classify.
  const INJECTED_SHAPE = /^\s*(Current runtime context|<system-reminder|<hindsight|\[MNEMON|MNEMON RUNTIME|<acp|<available_skills|USER\.md|MEMORY\.md|<skill_content|<context)/
  const userTextOf = (message: { content?: unknown } | undefined): string => (Array.isArray(message?.content) ? message.content as { type?: string; text?: string }[] : [])
    .filter(block => block?.type === 'text')
    .map(block => String(block.text ?? ''))
    .join(' ').trim()
  const lastRealUserText = (messages: readonly { role?: string; content?: unknown }[]): string => {
    for (const message of [...messages].reverse()) {
      if (message?.role !== 'user') continue
      const text = userTextOf(message)
      if (text && !INJECTED_SHAPE.test(text) && !NOTICE_SHAPE.test(text)) return text
    }
    return ''
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
      const binding = bindings.read(String(options.sessionId))?.binding
      const worker = binding?.selected ? binding.profile.worker : undefined
      if (!worker?.model) return lead
      return classifyUserText(lastRealUserText(options.messages ?? [])) === 'worker' ? worker : lead
    } catch { return lead }
  }
  ctx.effect(() => ctx.llm.registerAdapter([FUSION_NEXT_PROVIDER], new FusionCatalogAdapter(leadModelInfo, fusionDispatch, resolveFusionRoute)))
  // Prefix routing on the physical path: pair sessions stream straight through
  // their physical adapter, so the llm/stream waterfall is the only seam that
  // sees every request. A clearly simple newest-user turn reroutes to the
  // paired executor — its sandbox/gates stay the Lead's, the planner never runs.
  const rerouted = new WeakSet<GenerateOptions>()
  const routeVerdicts = new Map<string, 'worker' | 'lead'>()
  // The planner decides whether a turn is simple enough for the executor alone.
  // One tiny one-shot call per new user message (cached by session+text) — much
  // cheaper than letting the Lead run the whole turn, more reliable than a
  // keyword heuristic. Any failure falls back to the Lead.
  const judgeWithPlanner = async (lead: PhysicalRoute, text: string): Promise<'worker' | 'lead'> => {
    const prompt = [
      'Decide whether the newest user request can be fully handled by a cheaper junior executor.',
      'SIMPLE = read-only investigation or a short factual answer (reading, searching, explaining, comparing, counting, summarising) with no file changes needed.',
      'COMPLEX = anything that writes, executes, fixes, builds, or needs careful multi-step judgement.',
      'Answer with exactly one word: SIMPLE or COMPLEX. Request:',
      text.length > 4000 ? `${text.slice(0, 2000)}\n…\n${text.slice(-2000)}` : text,
    ].join('\n')
    try {
      const judge: GenerateOptions = {
        provider: lead.provider, model: lead.model, maxTokens: 8, temperature: 0,
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
    // A live work order means the Lead is orchestrating (reviews, reworks,
    // settles) — those requests must never leave the planner.
    const runtimeDoc = store.readDocument(`runtime:${binding?.taskId ?? ''}`)?.value as { currentWorkOrder?: { id?: string } } | undefined
    if (runtimeDoc?.currentWorkOrder?.id) { yield* next(); return }
    const text = lastRealUserText(request.messages ?? [])
    if (!text) { yield* next(); return }
    const verdictKey = `${request.sessionId}:${text.slice(0, 500)}`
    const verdict = routeVerdicts.get(verdictKey) ?? await judgeWithPlanner(lead, text)
    routeVerdicts.set(verdictKey, verdict)
    if (verdict !== 'worker') { yield* next(); return }
    const forward: GenerateOptions = { ...request, provider: worker.provider, model: worker.model, reasoningEffort: undefined }
    rerouted.add(forward)
    yield* ctx.llm.stream(forward)
  }, { prepend: true }))
  ctx.effect(() => installNativeFusionSelection(ctx, {
    coordinator: () => runtime, profile: () => defaultProfile,
    // C01 activation seam: once a session commits to Fusion, the journal-backed
    // lifecycle creates/restores the run + alias before the next model request.
    // Fail-closed capability gating lives inside the adapter; a denied or
    // failing activation surfaces as an explicit request error.
    activate: fusionActivate, suspend: fusionSuspend,
    workerOf, sessionProfile, leadChanged,
    // Fresh installs pair per session before any global settings are saved or
    // a binding warms the runtime — without this the coordinator stays
    // undefined and the lazy activation in the request seam silently no-ops.
    ensureCoordinator: async (sessionId, lead, worker) => {
      const resolved = sessionProfile(sessionId, lead, worker)
      await getRuntime(resolved)
    },
    // Physical routes applied via agent.model.select() journal an echo event;
    // the listener must recognise it instead of reading it as a menu action.
    appliedRoutes: { read: agentId => appliedPhysicalRoutes.get(agentId) },
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
    catch (error) { restoreFailure.set(payload.agent.id, String(error)); return { kind: 'reject' } }
    return next()
  }, { prepend: true }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/fusion-next', handler: async (req, res) => {
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
        if (url.searchParams.get('view') === 'catalog') return json(res, 200, await ctx.sessionController.modelCatalog())
        if (url.searchParams.get('view') === 'session-pair') {
          const sid = url.searchParams.get('sessionId') ?? ''
          const pair = sid ? readSessionPair(store, sid)?.pair : undefined
          const bound = sid ? bindings.read(sid)?.binding : undefined
          // The executor runs under the user's chosen mode (the sandbox-intent
          // records it; a user mode pick while paired is pushed to the Sidekick).
          const intent = sid ? store.readDocument(`sandbox-intent:${sid}`)?.value as { mode?: string } | undefined : undefined
          return json(res, 200, { worker: pair?.worker ?? null, lead: pair?.lead ?? null,
            selected: Boolean(bound?.selected), executorMode: intent?.mode ?? null,
            catalog: await physicalCatalog() })
        }
        if (url.searchParams.get('view') === 'session-usage') {
          // Per-session token totals for the composer badge: summed over every
          // usage-index projection for this session's task, split by role so the
          // client can show lead/worker contribution beside the model selector.
          const sid = url.searchParams.get('sessionId') ?? ''
          const binding = sid ? bindings.read(sid)?.binding : undefined
          const empty = { input: 0, output: 0, cacheRead: 0, calls: 0 }
          const totals: Record<string, { input: number; output: number; cacheRead: number; calls: number }> = {}
          const models: Record<string, { input: number; output: number; cacheRead: number; calls: number; role: string }> = {}
          const total = { ...empty }
          if (binding) {
            for (const id of store.listDocumentIds(`usage-index:${binding.taskId}:`)) {
              const row = store.readDocument(id)?.value as UsageSummary | undefined
              if (!row || row.taskId !== binding.taskId) continue
              const role = row.role || 'lead'
              const bucket = totals[role] ?? (totals[role] = { ...empty })
              const modelKey = `${row.provider}/${row.model}`
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
          // All sessions with a selected fusion binding, for the global panel.
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
          let profile: ResolvedProfile | undefined, reason: string | undefined, authorized = false
          try {
            profile = await configuredProfile()
            if (needsBudget(profile.profile)) budget.check(profileRoutes(profile.profile)); authorized = true
          } catch (error) { reason = error instanceof Error ? error.message : String(error) }
          return json(res, 200, { revision: saved?.revision ?? 0, catalog: await physicalCatalog(),
            pair: profile ? choiceFromProfile(profile.profile) : null,
            authorized, reason, managedAuthorization: Boolean(config.authorizationPath), policy: profile?.profile.interactionMode ?? 'legacy', actualBilledUsd: null, apiEquivalentUsd: null })
        }
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const binding = sessionId && bindings.read(sessionId)?.binding
        let available = false, reason: string | undefined
        try {
          const profile = binding && binding.selected ? { profile: binding.profile, prompts: binding.prompts } : await configuredProfile()
          const controller = await getRuntime(profile)
          controller.transport.assertAvailable()
          if (needsBudget(profile.profile)) budget.check(profileRoutes(profile.profile))
          available = true
        } catch (error) { reason = error instanceof Error ? error.message : String(error) }
        const state = binding && store.load(binding.taskId)
        return json(res, 200, { selected: Boolean(binding && binding.selected), available, ...(reason ? { reason } : {}),
          ...(state ? { task: { id: state.taskId, phase: state.phase, verification: state.verification, workerId: state.acceptedChild } } : {}) })
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      const body = await readJson(req)
      if (['continue', 'switch-role', 'schedule', 'cancel-schedule'].includes(String(body.action))) {
        if (typeof body.sessionId !== 'string' || typeof body.taskId !== 'string' || !Number.isSafeInteger(body.revision)) throw new Error(bi('恢复参数无效', 'Invalid recovery parameters'))
        const saved = bindings.read(body.sessionId)
        if (!saved?.binding.selected || saved.binding.taskId !== body.taskId || saved.binding.profile.interactionMode !== 'model-like') throw new Error(bi('当前任务不支持此恢复操作', 'This task does not support that recovery action'))
        const binding = saved.binding
        const controller = await getRuntime({ profile: binding.profile, prompts: binding.prompts })
        if (needsBudget(binding.profile)) budget.check(effectiveRoutes(binding))
        if (body.action === 'cancel-schedule') {
          const row = store.readDocument(`model-control:${body.sessionId}`)
          if (row?.revision !== body.revision) throw new Error(bi('状态已变化，请刷新', 'The state changed; refresh'))
          controller.modelControl.cancel(binding)
        } else if (body.action === 'schedule') {
          if (typeof body.dueAt !== 'string') throw new Error(bi('请选择继续时间', 'Choose when to continue'))
          await controller.modelControl.schedule(body.sessionId, body.taskId, Number(body.revision), body.dueAt)
        } else {
          let change: { role: 'lead' | 'worker'; route: typeof binding.profile.lead } | undefined
          if (body.action === 'switch-role') {
            if (body.role !== 'lead' && body.role !== 'worker') throw new Error(bi('请选择要更换的角色', 'Choose the role to switch'))
            const pair = validatePairChoice({ lead: body.route, worker: body.route }, await physicalCatalog())
            change = { role: body.role, route: pair.lead }
            if (needsBudget(binding.profile)) budget.check(profileRoutes({ ...binding.profile,
              lead: controller.modelControl.route(binding, 'lead'), worker: controller.modelControl.route(binding, 'worker'), [change.role]: change.route }))
          }
          await controller.modelControl.continue(body.sessionId, body.taskId, Number(body.revision), change)
        }
        return json(res, 200, { ok: true })
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
        const pair = validatePairChoice(body.pair, await physicalCatalog())
        const revision = store.writeDocument('settings:profile', Number(body.revision), modelProfileFromChoice(pair))
        const profile = await configuredProfile()
        await getRuntime(profile)
        return json(res, 200, { ok: true, revision })
      }
      if (body.action === 'authorize') {
        if (config.authorizationPath) throw new Error(bi('运行额度由外部授权文件管理，不能在此覆盖', 'Run limits are managed by an external authorization file and cannot be overridden here'))
        const saved = store.readDocument('settings:profile')
        if (!saved || saved.revision !== body.revision) throw new Error(bi('模型组合已变化，请刷新后再启用额度', 'The pair changed; refresh before enabling limits'))
        const profile = await configuredProfile()
        if (store.readDocument('settings:profile')?.revision !== body.revision) throw new Error(bi('模型组合已变化，请刷新后再启用额度', 'The pair changed; refresh before enabling limits'))
        const auth = authorizeConfiguredPair(store, profileRoutes(profile.profile), body.limits)
        return json(res, 200, { ok: true, expiresAt: auth.expiresAt })
      }
      if (body.action === 'session-pair') {
        if (typeof body.sessionId !== 'string' || !body.sessionId) throw new Error(bi('会话参数无效', 'Invalid session id'))
        const sessionId = body.sessionId
        const prior = readSessionPair(store, sessionId)
        if (body.worker === null) {
          // Executor cleared: leave Fusion for this session. A still-selected
          // binding is suspended + cleared so the next turn runs as a plain
          // session on the host selection.
          writeSessionPair(store, sessionId, prior?.revision ?? 0,
            { schemaVersion: 1, ...(prior?.pair ?? {}), worker: undefined })
          const binding = bindings.read(sessionId)?.binding
          if (binding?.selected) {
            fusionSuspend(sessionId)
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
        const catalog = await physicalCatalog()
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
  } }))
  ctx.effect(() => ctx.commands.register({ name: 'fusion-next', description: bi('Fusion 状态、暂停、恢复与退出（不调用模型）', 'Fusion status, pause, resume and exit (no model call)'),
    input: { hint: bi('status | pair [<provider>/]<model> | pair off [--force] | pause | resume | recover [--effects-stopped] <检查记录> | off [--force]', 'status | pair [<provider>/]<model> | pair off [--force] | pause | resume | recover [--effects-stopped] <inspection note> | off [--force]') },
    handler: async invocation => {
      const [action = 'status', ...note] = invocation.rawInput.trim().split(/\s+/)
      try {
        // `pair` is reachable without a selected binding: remote web deployments
        // cannot reach /api/fusion-next (localhost-only guard), so the chat
        // command is the remote-safe pairing path.
        if (action === 'pair') {
          const sessionId = invocation.agent.id
          const prior = readSessionPair(store, sessionId)
          const target = note[0]
          if (!target) {
            const pair = prior?.pair
            if (!pair?.worker)
              return { kind: 'success', text: bi('本会话未设定执行模型。用 /fusion-next pair [<provider>/]<model> 设定，pair off 退出。', 'No executor set. Use /fusion-next pair [<provider>/]<model> to set one, pair off to exit.') }
            const intentMode = (store.readDocument(`sandbox-intent:${sessionId}`)?.value as { mode?: string } | undefined)?.mode
            const modeText = intentMode ? bi(`，执行权限 ${intentMode}`, `, executor mode ${intentMode}`) : ''
            return { kind: 'success', text: bi(`本会话执行模型：${pair.worker.provider}/${pair.worker.model}（规划 ${pair.lead?.provider}/${pair.lead?.model}）${modeText}。`, `Executor: ${pair.worker.provider}/${pair.worker.model} (planner ${pair.lead?.provider}/${pair.lead?.model})${modeText}.`) }
          }
          if (target === 'off' || target === 'none') {
            writeSessionPair(store, sessionId, prior?.revision ?? 0,
              { schemaVersion: 1, ...(prior?.pair ?? {}), worker: undefined })
            const pairBinding = bindings.read(sessionId)?.binding
            if (pairBinding?.selected) {
              fusionSuspend(sessionId)
              const controller = await getRuntime({ profile: pairBinding.profile, prompts: pairBinding.prompts })
              if (invocation.agent.status !== 'idle') await controller.pause(invocation.agent)
              await controller.clear(invocation.agent, { abandon: note.includes('--force') })
            }
            return { kind: 'success', text: bi('本会话已退出 Fusion 编队，恢复为普通会话。', 'Fusion pair cleared; this session is a normal conversation again.') }
          }
          // Forms: `<provider> <model>` two-arg, `provider/model`, or a bare
          // model id (model ids themselves may contain '/', e.g. 'devin/swe-2'
          // under provider 'cpa'). Bare-model match wins over the provider
          // split to keep 'devin/swe-2' unambiguous.
          const catalog = await physicalCatalog()
          const entries = catalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model })))
          const match = note[1]
            ? entries.find(entry => entry.provider === note[0] && entry.model.id === note[1])
            : entries.find(entry => entry.model.id === target)
              ?? entries.find(entry => {
                const slash = target.indexOf('/')
                return slash > 0 && entry.provider === target.slice(0, slash) && entry.model.id === target.slice(slash + 1)
              })
          if (!match) throw new Error(bi(`执行模型 ${target} 不可用；请查看模型目录。`, `Executor model ${target} is not available; check the model catalog.`))
          const worker: PhysicalRoute = { provider: match.provider, model: match.model.id }
          writeSessionPair(store, sessionId, prior?.revision ?? 0,
            { schemaVersion: 1, ...(prior?.pair ?? {}), worker })
          return { kind: 'success', text: bi(`已为会话设定执行模型 ${match.provider}/${match.model.id}。发送下一条消息即按编队执行。`, `Executor set to ${match.provider}/${match.model.id}. The next message runs as a Fusion pair.`) }
        }
        const binding = bindings.read(invocation.agent.id)?.binding
        if (!binding?.selected) return { kind: 'success', text: bi('当前会话未启用 Fusion。请在模型选择器中选择 Fusion Next · 自动。', 'Fusion is not selected in this conversation. Choose Fusion · auto in the model menu.') }
        if (action === 'status' || action === '') {
          const controller = await getRuntime({ profile: binding.profile, prompts: binding.prompts })
          const state = store.load(binding.taskId)!
          const unfinishedEffects = controller.effects.pending(binding.taskId).map(({ record }) => ({ role: record.role, tool: record.toolName }))
          const usage = store.listDocumentIds(`usage:${state.taskId}:`).map(id => store.readDocument(id)!.value as { purpose?: string })
          return { kind: 'success', text: JSON.stringify({ taskId: state.taskId, phase: state.phase, verification: state.verification,
            control: state.control, workerId: state.acceptedChild, modelCalls: usage.length,
            cacheKeepaliveCalls: usage.filter(row => row.purpose === 'cache-keepalive').length,
            compactionCalls: usage.filter(row => row.purpose === 'compaction').length,
            unfinishedEffects, ...(unfinishedEffects.length ? { recoveryHint: bi('请核对中断的工具操作，确认对应命令及子进程已停止；Host 退出不代表这些操作已结束。', 'Check the interrupted tool operations and confirm their commands and child processes stopped; a Host exit does not end them.') } : {}),
            actualBilledUsd: null, apiEquivalentUsd: null }, null, 2) }
        }
        const controller = await getRuntime({ profile: binding.profile, prompts: binding.prompts })
        if (action === 'pause') { controller.modelControl.cancel(binding); await controller.pause(invocation.agent) }
        else if (action === 'resume') {
          const authorizationId = needsBudget(binding.profile) ? budget.check(effectiveRoutes(binding)).authorizationId : 'native-account'
          if (binding.profile.interactionMode === 'model-like') await controller.modelControl.continue(binding.sessionId, binding.taskId,
            store.readDocument(`model-control:${binding.sessionId}`)?.revision ?? 0)
          else await controller.resume(invocation.agent, authorizationId)
        } else if (action === 'recover') await controller.reconcile(invocation.agent, { commandId: invocation.commandId,
          effectsStopped: note[0] === '--effects-stopped', note: (note[0] === '--effects-stopped' ? note.slice(1) : note).join(' ') })
        else if (action === 'off') {
          await controller.clear(invocation.agent, { abandon: note.includes('--force') })
          await ctx.sessionController.selectModel({ sessionId: SessionId(invocation.agent.id), ...binding.profile.lead })
        }
        else throw new Error(bi('使用 /fusion-next status、pause、resume、recover <检查记录> 或 off', 'Use /fusion-next status, pause, resume, recover <inspection note> or off'))
        return { kind: 'success', text: action === 'resume' ? binding.profile.interactionMode === 'model-like' ? bi('已通过原生收件箱提交一次继续操作。', 'One continuation was submitted through the native inbox.') : bi('Fusion 已恢复。发送下一条消息继续当前任务。', 'Fusion resumed. Send a message to continue the task.') : bi(`Fusion ${action} 已完成。`, `Fusion ${action} done.`) }
      } catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) } }
    } }))
  ctx.effect(() => async () => { if (creating) await creating.catch(() => undefined); if (runtime) await runtime.close(); store.close() })
  // Warm only configuration/scopes; initialization performs no inference.
  try { await getRuntime(await configuredProfile()) }
  catch {
    const selected = bindings.selected()[0]
    if (selected) await getRuntime({ profile: selected.profile, prompts: selected.prompts })
  }
  ctx.logger.info('[my-plugins/fusion-next] loaded')
}
