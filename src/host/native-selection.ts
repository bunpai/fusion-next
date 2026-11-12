import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, ModelModality, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type { PhysicalRoute } from '../contracts.js'
import type { ResolvedProfile } from '../profile/resolve.js'
import type { FusionCoordinator } from './coordinator.js'

export const FUSION_PROVIDER = 'dsh-model-fusion'
export const FUSION_MODEL = 'auto'
export const isFusionSelection = (route: { provider?: string; model?: string } | undefined): boolean =>
  route?.provider === FUSION_PROVIDER && route.model === FUSION_MODEL

/** Resolves the configured Lead's declared input modalities; undefined means unconfigured or unverifiable. */
export type LeadInputModalities = () => Promise<readonly ModelModality[] | undefined>

/** Streams one request through the route's physical adapter via the LLM runtime. */
export type FusionDispatch = (options: GenerateOptions, route: PhysicalRoute) => AsyncIterable<StreamChunk>

/**
 * Virtual local provider: the session and agent model state stay on
 * dsh-model-fusion/auto (UI identity + journal intent), while every stream is
 * dispatched through the configured Lead's physical route. Auxiliary callers
 * (session title) take the same route and never block a turn.
 */
export class FusionCatalogAdapter extends LlmAdapter {
  constructor(
    private readonly leadInputModalities?: LeadInputModalities,
    private readonly dispatch?: FusionDispatch,
    private readonly resolveLead?: () => PhysicalRoute | undefined,
  ) { super() }
  override providerInfo(provider: string) { return { id: provider, name: 'Fusion' } }
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    // The Lead is the only role that reads user content, so the entry admits
    // exactly what the configured Lead admits; text-only until it resolves.
    const lead = (await this.leadInputModalities?.()) ?? []
    return [{ provider, id: FUSION_MODEL, name: 'Fusion · 自动',
      description: 'Lead 与 Worker 协作。在设置 → Fusion 中配置模型。',
      inputModalities: [...new Set<ModelModality>(['text', ...lead])] }]
  }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (provider !== FUSION_PROVIDER || model !== FUSION_MODEL) throw new Error('Unknown local Fusion selection')
    return (await this.listModels(provider))[0]!
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route = this.resolveLead?.()
    if (!route || !this.dispatch) {
      // Unconfigured Fusion. Never throw synchronously — the session-title
      // pipeline escalates a thrown LlmError into a turn failure. Yield a soft
      // finish instead so the host falls back to its first-prompt title, matching
      // the old adapter's semantics where auxiliary requests never block a turn.
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: new LlmError('Fusion 尚未就绪。请前往设置 → Fusion 配置 Lead 和 Worker。', 'FUSION_NOT_READY').failure }
      }
      return
    }
    // Dispatch through the Lead's physical adapter. The token meter sees both
    // the fusion call and the physical call (known accounting duplicate until
    // the dedicated Fusion LLM layer replaces this delegation).
    yield* this.dispatch({
      ...options,
      provider: route.provider,
      model: route.model,
      reasoningEffort: route.reasoningEffort === undefined ? undefined : ReasoningEffortId(route.reasoningEffort),
    }, route)
  }
}

/** Public native lifecycle integration. No model-menu replacement or Host patch. */
export function installNativeFusionSelection(ctx: Context, input: {
  coordinator(): FusionCoordinator | undefined
  profile(): ResolvedProfile | undefined
  selection(agent: Agent): PhysicalRoute | undefined
  /**
   * Optional C01 activation seam, invoked once a session commits to Fusion.
   * The Host adapter is supplied by later integration tasks; when absent this
   * installer keeps its previous behavior unchanged (fail-closed, no Host calls).
   */
  activate?(sessionId: string): void
  /**
   * Registry of physical routes the scope layer applied via agent.model.select().
   * 0.2.2 journals every select, so the journal's latest model/selection becomes
   * our own physical echo; without this registry the echo reads as a user's menu
   * action and clears the freshly created Fusion binding mid-turn. The caller
   * owns the map because the scope installer marks it through its own callback
   * chain (scopes → coordinator options → entry).
   */
  appliedRoutes?: { read(agentId: string): { provider: string; model: string } | undefined }
  /**
   * S03 seam: a user switch away from Fusion suspends the journal-backed run.
   * Called when the effective selection leaves Fusion while a binding is
   * selected; the caller journals RUN_SUSPEND_REQUESTED/RUN_SUSPENDED (or the
   * blockers that make the transition visible). Best-effort like activate.
   */
  suspend?(sessionId: string): void
}): () => void {
  const pending = new Map<string, Promise<void>>()
  const failures = new Map<string, string>()
  const desired = new Map<string, PhysicalRoute>()
  // The session journal is the authoritative latest selection: two quick
  // model/selection events (menu re-assert + new pick) can otherwise leave a
  // stale desired entry that clears a just-created Fusion binding.
  const sessionSelection = (agent: Agent) => {
    const last = agent.session.snapshotEvents().findLast(event => event.type === 'model/selection')
    const data = last?.data as PhysicalRoute | undefined
    if (data && !isFusionSelection(data)) {
      const echoed = input.appliedRoutes?.read(agent.id)
      // A physical selection identical to the route we applied ourselves is the
      // journal echo of agent.model.select(), never a user intent. The scope
      // layer only selects while a Fusion binding is active, so the effective
      // selection stays Fusion; the desired map must not be consulted either,
      // because the echo event also wrote itself there.
      if (echoed && data.provider === echoed.provider && data.model === echoed.model) return { provider: FUSION_PROVIDER, model: FUSION_MODEL }
    }
    return data
  }
  const selection = (agent: Agent) => sessionSelection(agent) ?? desired.get(agent.id) ?? input.selection(agent)
  const selected = (agent: Agent) => input.coordinator()?.bindings.read(agent.id)?.binding.selected === true
  const change = (agent: Agent) => {
    if (agent.session.header.parentSession || pending.has(agent.id)) return
    const coordinator = input.coordinator(), profile = input.profile(), route = selection(agent)
    if (!coordinator) return
    if (isFusionSelection(route)) {
      if (!selected(agent) && profile) coordinator.selectBeforeAssembly(agent, profile)
      if (selected(agent)) {
        // A saved Host default need not emit model/selection. Persist that
        // already-chosen intent before physical headers reach the native menu's
        // projection, otherwise it starts displaying the Lead as the selection.
        const intent = agent.session.snapshotEvents().findLast(event => event.type === 'model/selection')
        if (!isFusionSelection(intent?.data)) agent.session.append('model/selection', {
          provider: FUSION_PROVIDER, model: FUSION_MODEL,
        })
        // C01 activation seam: the caller-verified capability gate lives inside
        // the adapter; a denied or failing activation blocks the next request.
        if (input.activate) {
          try { input.activate(agent.session.id) } catch (error) { failures.set(agent.id, String(error)) }
        }
        failures.delete(agent.id)
      }
      return
    }
    if (!selected(agent)) return
    // Journal the physical suspend BEFORE pausing: the coordinator pause is
    // unconditional user intent, so the v2 journal must reflect it even when
    // the service-level blocker policy would defer. Errors block the next
    // request the same way activation failures do.
    if (input.suspend) {
      try { input.suspend(agent.session.id) } catch (error) { failures.set(agent.id, String(error)) }
    }
    const transition = (async () => {
      if (agent.status !== 'idle') await coordinator.pause(agent)
      await coordinator.clear(agent)
      failures.delete(agent.id)
    })().catch(error => { failures.set(agent.id, String(error)) }).finally(() => { pending.delete(agent.id) })
    pending.set(agent.id, transition)
  }
  const disposers = [
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'model/selection') return
      desired.set(session.id, event.data)
      const agent = ctx.agents.get(SessionId(session.id))
      if (agent && (agent.status === 'idle' || !isFusionSelection(event.data))) change(agent)
      else if (agent && !selected(agent)) agent.cancel({ kind: 'hook', reason: 'Fusion selection takes effect after this turn settles' }, { keepInbox: true })
    }),
    ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'running' || agent.session.header.parentSession) return
      if (pending.has(agent.id) && selected(agent)) {
        agent.cancel({ kind: 'hook', reason: 'Model switch is draining the previous Fusion task' }, { keepInbox: true })
        return
      }
      // The synchronous running reservation precedes prompt/tool assembly.
      try { change(agent) } catch (error) { failures.set(agent.id, String(error)) }
    }),
    ctx.on('agent/request', async (payload, next) => {
      const config = await next(), agent = payload.agent
      if (agent.session.header.parentSession) return config
      const route = selection(agent)
      if ((pending.has(agent.id) && selected(agent)) || failures.has(agent.id)) throw new Error(failures.get(agent.id) ?? 'Fusion 正在完成模型切换，请稍后继续')
      if (isFusionSelection(route)) {
        // A newly installed exact-Agent interceptor can wrap this listener;
        // its physical route is applied after this continuation returns.
        // The catalog adapter itself cannot dispatch any upstream request.
        if (!selected(agent)) throw new Error('请先在设置 → Fusion 配置 Lead 和 Worker，再继续此会话。')
      } else if (selected(agent)) throw new Error('先停止当前 Fusion 任务，再切换模型。')
      return config
    }, { prepend: true }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
