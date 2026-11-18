import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { requestOutputReservation } from '../context/guard.js'
import type { PhysicalRoute, Role } from '../contracts.js'
import type { SessionBinding } from './bindings.js'
import { digestOf } from '../digest.js'
import { fusionToolDiagnostic, projectRoleTools } from './tool-table.js'

export interface FusionScopeCallbacks {
  route?(binding: SessionBinding, role: Role): PhysicalRoute
  beforeTurn?(agent: Agent, binding: SessionBinding, role: Role, turn: number): SessionBinding
  taskContext?(agent: Agent, binding: SessionBinding, role: Role): UserMessage | undefined
  beforeStep?(agent: Agent, binding: SessionBinding, role: Role): void
  /**
   * Fires on the session's `compaction/start` event — the last moment to
   * rewrite surface history before the compactor reads it. Use this for
   * in-place replacements only: running them per-step would poison the
   * frontier model's prompt cache (every byte after the edit re-encodes).
   */
  beforeCompaction?(agent: Agent, binding: SessionBinding, role: Role): void
  projectMessage?(agent: Agent, binding: SessionBinding, role: Role, message: UserMessage): UserMessage
  /** All independent pause, budget, recovery and unknown-effect gates are checked here. */
  canAccess?(agent: Agent, binding: SessionBinding, role: Role): string | undefined
  /** Shared gates plus limits that apply only to admitting a new generation. */
  prepareRequest?(agent: Agent, binding: SessionBinding, role: Role, signal: AbortSignal): Promise<void>
  canRequest(agent: Agent, binding: SessionBinding, role: Role): string | undefined
  canExecute(exec: Readonly<ToolExecution>, binding: SessionBinding, role: Role): string | undefined
  beforeRequest(agent: Agent, turn: number, step: number, binding: SessionBinding, role: Role): void
  /** Disclosed context window for this physical model, read when the request is built. */
  modelLimits?(provider: string, model: string): Promise<{ contextWindow: number; defaultMaxTokens?: number; testedOutputCap?: number }>
  /**
   * Reports the physical route this installer applied via agent.model.select().
   * The selection listener uses it to recognise its own journal echo (0.2.2
   * journals every select) instead of reading it as a user's menu action.
   */
  onPhysicalRouteSelected?(agentId: string, route: { provider: string; model: string }): void
  /** Read-stage tools, presented natively. Undefined restores the native composition. */
  readOnlyTools?(agent: Agent, binding: SessionBinding, role: Role): readonly string[] | undefined
  installTools(scope: Context, agent: Agent, binding: SessionBinding, role: Role): readonly (() => void)[]
}

interface ScopeEntry {
  readonly agent: Agent
  binding: SessionBinding
  readonly role: Role
  readonly dispose: (() => void)[]
  refreshTools(): void
  ready: boolean
  /** True when the physical route was applied via agent.model.select() (0.2.2+ contract). */
  seq?: number
  /** 0.2.2 races the turn driver against runMaintenance(install); pre-step waits on this. */
  readonly readyPromise?: Promise<void>
  readonly resolveReady?: () => void
}

/** Physical routing, prompt and tools live in the exact native Agent scope. */
export class NativeFusionScopes {
  static installSeq = 0
  readonly #entries = new Map<string, ScopeEntry>()
  constructor(private readonly callbacks: FusionScopeCallbacks) {}

  get(agent: Agent): { binding: SessionBinding; role: Role } | undefined {
    const entry = this.#entries.get(agent.id)
    return entry?.agent === agent ? { binding: entry.binding, role: entry.role } : undefined
  }

  assertReady(agent: Agent): void {
    const entry = this.#entries.get(agent.id)
    if (!entry || entry.agent !== agent || !entry.ready) throw new Error('Fusion Agent scope is not ready; execution is blocked')
    const reason = (this.callbacks.canAccess ?? this.callbacks.canRequest)(agent, entry.binding, entry.role)
    if (reason) throw new Error(reason)
  }

  install(agent: Agent, binding: SessionBinding, role: Role): void {
    const old = this.#entries.get(agent.id)
    if (old) {
      if (old.agent === agent && old.binding.taskId === binding.taskId && old.role === role && old.ready) return
      // A native continuable activation may be released between turns. Its
      // resumed Agent has the same durable id but a fresh exact scope.
      if (old.agent !== agent && old.agent.status === 'idle') this.detach(old.agent)
      else throw new Error('An existing Fusion scope must settle and detach before replacement')
    }
    const entry: ScopeEntry = { agent, binding: structuredClone(binding), role, dispose: [], ready: false, refreshTools: () => {}, }
    entry.seq = ++NativeFusionScopes.installSeq
    let resolveReady: () => void = () => {}
    const readyPromise = new Promise<void>(resolve => { resolveReady = resolve })
    const entryWithGate = entry as typeof entry & { readyPromise?: Promise<void>; resolveReady?: () => void }
    entryWithGate.readyPromise = readyPromise
    entryWithGate.resolveReady = () => resolveReady()
    this.#entries.set(agent.id, entry)
    const policy = entry.binding.profile.context[role]
    const scope = agent.ctx
  try {
      let readOnlyTools: readonly string[] | undefined
      let presentationKey: string | undefined
      const stageDisposers: (() => void)[] = []
      const clearStage = () => { for (const dispose of stageDisposers.splice(0).reverse()) dispose() }
      entry.dispose.push(clearStage)
      entry.refreshTools = () => {
        const tools = this.callbacks.readOnlyTools?.(agent, entry.binding, role)
        const key = JSON.stringify(tools ?? null)
        if (key === presentationKey) return
        clearStage()
        readOnlyTools = tools
        if (tools !== undefined) {
          // A Lead's capability ceiling is also used when validating a new child.
          // Only mask its prompt; restricting inheritance would disable Worker writes.
          // Permission narrowing is load-bearing: a Host without restrict() must fail
          // closed instead of silently widening the Worker's tools.
          if (role === 'worker') {
            if (typeof scope.tools.restrict !== 'function') throw new Error('Fusion scope requires scope.tools.restrict; the connected Host SDK is incompatible')
            stageDisposers.push(scope.tools.restrict({ allow: tools }))
          }
          // Any concrete allowlist is presented natively, including an implement-mode
          // Worker on 0.2.1 whose ceiling moved here from the removed start-time toolFilter.
          // 0.2.0 implement mode still returns undefined, so this call does not start applying there.
          // 0.2.2-rc.1 removed presentAs (native presentation became the default), so
          // feature-detect it: presentation is cosmetic, unlike restrict().
          if (typeof scope.tools.presentAs === 'function') stageDisposers.push(scope.tools.presentAs('native'))
        }
        presentationKey = key
      }
      // Register the deny-only native guard first. A failed partial install stays closed.
      entry.dispose.push(scope.tools.guard(exec => {
        if (!entry.ready) return 'Fusion scope initialization failed'
        return this.callbacks.canExecute(exec, entry.binding, role)
      }))
      entry.dispose.push(scope.on('session/event', (session, event) => {
        if (session !== agent.session || !entry.ready) return
        // In-place surface edits belong to the compactor boundary only: doing
        // them per-step rewrites mid-context bytes and destroys prompt cache.
        if (event.type === 'compaction/start') { this.callbacks.beforeCompaction?.(agent, entry.binding, role); return }
        if (event.type !== 'turn/start' || !this.callbacks.beforeTurn) return
        try {
          const nextBinding = this.callbacks.beforeTurn(agent, entry.binding, role, event.data.turn)
          if (nextBinding.sessionId !== entry.binding.sessionId || digestOf(nextBinding.profile) !== digestOf(entry.binding.profile)
            || digestOf(nextBinding.prompts) !== digestOf(entry.binding.prompts)) throw new Error('Task rollover must preserve the frozen route and prompts')
          entry.binding = structuredClone(nextBinding)
          // Do NOT re-run selectRoute here: 0.2.2 journals model/selection inside
          // agent.model.select(), and turn/start is dispatched inside an append
          // publication — re-selecting throws 'session append cannot reenter...'
          // and the catch would flip the entry unready for the whole turn. The
          // physical route applied at install persists in the agent's model state.
          entry.refreshTools()
        } catch (error) { entry.ready = false; throw error }
      }))
      entry.dispose.push(scope.on('agent/pre-step', async (payload, next) => {
        if (payload.agent !== agent) return { kind: 'reject' }
        if (!entry.ready && entry.readyPromise) {
          // 0.2.2 races the turn driver against runMaintenance(selectBeforeAssembly):
          // the turn can reach the pre-step waterfall before scopes.install() finished.
          await Promise.race([entry.readyPromise, new Promise<void>(resolve => setTimeout(resolve, 15000))])
        }
        if (!entry.ready) return { kind: 'reject' }
        await this.callbacks.prepareRequest?.(agent, entry.binding, role, payload.signal)
        payload.signal.throwIfAborted()
        const blocked = this.callbacks.canRequest(agent, entry.binding, role)
        if (blocked) return { kind: 'reject' }
        this.callbacks.beforeStep?.(agent, entry.binding, role)
        const decision = await next()
        if (decision.kind === 'reject') return decision
        // Native compaction can run inside next(), after prompt assembly. Form
        // this user-role snapshot afterwards so the next request retains facts.
        const taskContext = this.callbacks.taskContext?.(agent, entry.binding, role)
        // Native selection compares the virtual menu route to the physical
        // request header. That is not a new model change on every Fusion step.
        return { ...decision, messages: [...decision.messages.filter(message => !(message.source?.kind === 'model-selection' && message.source.form === 'notice'
          && message.source.summary.endsWith('fusion-next/auto'))).map(message =>
          this.callbacks.projectMessage?.(agent, entry.binding, role, message) ?? message), ...(taskContext ? [taskContext] : [])] }
      }, { prepend: true }))
      entry.dispose.push(scope.systemPrompt.section({ name: 'fusion-role', order: 90, text: entry.binding.prompts[role] }))
      entry.dispose.push(scope.on('system-prompt/assemble', async (_assembly, _context, next) => {
        entry.refreshTools()
        const assembled = await next()
        const route = this.callbacks.route?.(entry.binding, role) ?? entry.binding.profile[role]
        if (assembled.tools === undefined) {
          // 0.2.2-rc.1 no longer exposes the tool table through system-prompt/assemble.
          // The deny-only scope guard and Worker restrict() still enforce permissions,
          // so only the belt-and-braces restore pass is unavailable here.
          return { ...assembled, variables: { ...(assembled.variables ?? {}), provider: route.provider, model: route.model } }
        }
        // Another plugin may replace assembled.tools inside next() (dsh-tool-search
        // swaps in its eager set). Put this role's permitted tools back from the
        // registry. Required means "this agent registered it and the role may see
        // it", so a legacy allowlist that names a model-like-only tool is not a gap.
        // The deny-only guard still rejects a hidden local tool that was not restored.
        const projected = projectRoleTools({
          assembled: assembled.tools,
          allowlist: readOnlyTools,
          registry: scope.tools.schemas(agent),
          always: role === 'worker' ? ['fusion_next_read_state', 'fusion_next_read_evidence', 'fusion_next_list_evidence', 'fusion_next_submit_result'] : [],
        })
        if (projected.missing.length) throw new Error(fusionToolDiagnostic(projected.missing))
        return { ...assembled, variables: { ...(assembled.variables ?? {}), provider: route.provider, model: route.model }, tools: projected.tools }
      }, { prepend: true }))
      entry.dispose.push(scope.on('agent/request', async ({ agent: requesting, turn, step, signal }, next) => {
        this.assertReady(requesting)
        await this.callbacks.prepareRequest?.(requesting, entry.binding, role, signal)
        signal.throwIfAborted()
        const reason = this.callbacks.canRequest(requesting, entry.binding, role)
        if (reason) throw new Error(reason)
        const config = await next()
        const route = this.callbacks.route?.(entry.binding, role) ?? entry.binding.profile[role]
        this.callbacks.beforeRequest(agent, turn, step, entry.binding, role)
        const { reasoningEffort: _prior, ...rest } = config
        if (entry.binding.profile.interactionMode === 'model-like') {
          const { maxTokens, ...native } = rest
          return { ...native, ...(role === 'lead' && maxTokens !== undefined ? { maxTokens } : {}) }
        }
        const disclosed = this.callbacks.modelLimits
          ? await this.callbacks.modelLimits(route.provider, route.model) : undefined
        // A new native child inherits its parent's creation maxTokens, whereas
        // a cold continuable activation deliberately does not persist that value.
        // The Worker is plugin-owned: resolve its own route allowance on both
        // paths. An explicit cap on the user-facing Lead still takes precedence.
        const requested = role === 'lead' ? config.maxTokens : undefined
        const maxTokens = disclosed
          ? requestOutputReservation(disclosed.contextWindow, requested, disclosed.defaultMaxTokens, disclosed.testedOutputCap, policy.reserveOutputTokens)
          : Math.min(requested ?? policy.reserveOutputTokens, policy.reserveOutputTokens)
        return { ...rest, maxTokens }
      }, { prepend: true }))
      // Register before the first refresh. refreshTools() snapshots presentAs/restrict,
      // and a later assemble returns early when the allowlist key is unchanged, so a
      // refresh that runs first omits Fusion tools for the opening turn.
      entry.dispose.push(...this.callbacks.installTools(scope, agent, entry.binding, role))
      entry.refreshTools()
      entry.ready = true
      entry.resolveReady?.()
  } catch (error) { throw error }
  }

  /** Refresh at the persisted state transition, before native prompt providers run. */
  refreshTools(agent: Agent): void {
    const entry = this.#entries.get(agent.id)
    if (entry?.agent !== agent || !entry.ready) return
    try { entry.refreshTools() }
    catch (error) { entry.ready = false; throw error }
  }

  /**
   * Caller owns quiescence and the original session-controller model selection.
   * Removing these listeners reveals that existing selection; it does not mutate
   * a request header or fabricate a replacement global default.
   */
  detach(agent: Agent): void {
    const entry = this.#entries.get(agent.id)
    if (!entry || entry.agent !== agent) return
    if (agent.status !== 'idle') throw new Error('Cannot detach Fusion while the native Agent is running')
    entry.ready = false
    for (const dispose of entry.dispose.reverse()) dispose()
    this.#entries.delete(agent.id)
  }
}
