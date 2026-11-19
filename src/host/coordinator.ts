import { randomUUID } from 'node:crypto'
import { bi } from '../bilingual.js'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { TaskId, SessionId as FusionSessionId, type Role } from '../contracts.js'
import type { SqliteFusionStore } from '../task/sqlite-store.js'
import type { ResolvedProfile } from '../profile/resolve.js'
import { BindingRepository, type SessionBinding } from './bindings.js'
import { NativeWorkerTransport, type SubagentSeam } from './native-worker.js'
import { NativeFusionScopes } from './native-scopes.js'
import { NativeEffects } from './native-effects.js'
import { NativeCacheKeepalive, keepalivePolicy } from './native-keepalive.js'
import { NativeAuxiliaryRequests } from './native-auxiliary.js'
import { observeNativeUsage } from './native-usage.js'
import { NativeFusionActivity } from './native-activity.js'
import { resolveModelOutputLimits } from './model-output.js'
import { createRuntime, readRuntime, updateRuntime, type RuntimeV3 } from './runtime-v3.js'
import { runDispatch, type DispatchArgs } from './dispatch-v3.js'

/**
 * Fusion Coordinator v3 — one tool (fusion_dispatch), one durable worker
 * child per task, zero ceremony. Replaces the 11-tool workflow and its
 * sandbox/lease/review machinery with:
 *   1. scopes for role prompt + tool surface + route (unchanged mechanism),
 *   2. fusion_dispatch = start/continue + uninterrupted settle + deterministic audit,
 *   3. subagent interception rerouting read-only exploration to the executor,
 *   4. soft post-execute reminders instead of hard guards (host sandbox is the boundary).
 */
export interface CoordinatorOptions {
  readonly profile: ResolvedProfile
  readonly workerTools: readonly string[]
}

export interface CoordinatorOwner {
  readonly binding: SessionBinding
  readonly role: Role
}

interface ChildRow { parent?: string; taskId?: string; lane?: string }

const READ_TOOLS = new Set(['read', 'grep', 'glob', 'tgrep', 'read_image', 'job_output'])
const EXPLORE_LANE_TOOLS = ['read', 'grep', 'glob', 'tgrep', 'read_image']
// M2.5 — in pair mode the Lead holds NO workspace-write/execute capability; every
// mutation reaches the workspace through fusion_dispatch. Analysis, delegation,
// presentation, and control-plane tools stay. run_code stays (outer channel) —
// its inner write/execute primitives hit the same guard and are denied there.
const LEAD_LANE_TOOLS = new Set([
  'read', 'grep', 'glob', 'tgrep', 'read_image',
  'web_fetch', 'web_search',
  'subagent', 'run_code', 'fusion_dispatch',
  'job_list', 'job_output', 'job_kill',
  'list_agents', 'send_message', 'interrupt_agent', 'wait_agent',
  'todo_write', 'create_goal', 'get_goal', 'update_goal',
  'skill', 'workflow', 'exit_plan_mode', 'ask_user_question',
  'compress', 'decompress', 'search_context', 'acp_status', 'acp_cache',
])

/**
 * M2.5 lead-lane write boundary as a pure predicate (unit-testable penetration
 * matrix). Returns the bilingual denial or undefined when the tool is allowed.
 */
export function leadLaneDeny(toolName: string): string | undefined {
  if (LEAD_LANE_TOOLS.has(toolName)) return undefined
  return bi(
    'Lead 没有工作区写/执行权限 — 一切变更经由 fusion_dispatch 交给执行模型（' + toolName + ' 被拒）。',
    'The Lead holds no workspace write/execute capability — every change goes through fusion_dispatch to the executor (' + toolName + ' denied).')
}

const textOutput = {
  schema: { type: 'string' as const },
  render: (_args: unknown, text: string): ContentBlock[] => [{ type: 'text' as const, text }],
}

const linesOf = (text: string): number => text.split('\n').length

export class FusionCoordinator {
  readonly transport: NativeWorkerTransport
  readonly auxiliary = new NativeAuxiliaryRequests()
  readonly activity: NativeFusionActivity
  readonly bindings: BindingRepository
  readonly scopes: NativeFusionScopes
  readonly effects: NativeEffects
  readonly keepalive: NativeCacheKeepalive
  readonly #dispose: (() => void)[] = []
  #closed = false

  constructor(
    private readonly ctx: Context,
    private readonly store: SqliteFusionStore,
    private readonly options: CoordinatorOptions,
  ) {
    this.transport = new NativeWorkerTransport(ctx)
    this.bindings = new BindingRepository(store)
    this.activity = new NativeFusionActivity(ctx, store)
    this.scopes = new NativeFusionScopes({
      route: (binding, role) => (role === 'worker' ? binding.profile.worker : binding.profile.lead),
      beforeTurn: (_agent, binding) => binding,
      beforeRequest: () => {},
      canAccess: (_agent, binding) => this.#denyPaused(binding.taskId),
      canRequest: (_agent, binding) => this.#denyPaused(binding.taskId),
      canExecute: (exec, _binding, role) => this.#canExecute(exec, role),
      modelLimits: (provider, model) => resolveModelOutputLimits(ctx, provider, model),
      readOnlyTools: (agent, _binding, role) => this.#readOnlyTools(agent, role),
      installTools: (scope, agent, binding, role) => this.#installTools(scope, agent, binding, role),
    })
    this.effects = new NativeEffects(ctx, store, {
      owner: agent => this.owner(agent),
      track: exec => !READ_TOOLS.has(exec.name),
      failed: (_agent, error) => this.ctx.logger.error('[fusion-next] native effect failed: ' + String(error)),
    })
    this.keepalive = new NativeCacheKeepalive(ctx, store, this.auxiliary, {
      owner: agent => this.owner(agent),
      allowed: (_agent, owner) => !readRuntime(store, owner.binding.taskId)?.paused,
      failed: (_agent, reason) => this.ctx.logger.warn('[fusion-next] keepalive stopped: ' + reason),
      policy: owner => {
        const pref = keepalivePolicy(owner.binding, owner.role)
        return { mode: pref === true ? 'on' : pref === false ? 'off' : 'auto', intervalMs: 285_000 }
      },
    })
    this.#dispose.push(
      ctx.on('agent/created', async ({ agent }) => {
        try { this.#attachKnown(agent) }
        catch (error) { this.ctx.logger.warn('[fusion-next] child attach failed: ' + (error instanceof Error ? error.message : String(error))) }
        return undefined
      }),
      ctx.on('tools/execute', async (exec, next) => this.#interceptExplore(exec, next), { prepend: true }),
      this.effects.install(),
      observeNativeUsage(ctx, store, agent => {
        const owner = this.owner(agent)
        return owner ? { taskId: owner.binding.taskId, role: owner.role } : undefined
      }, this.auxiliary),
    )
    this.keepalive.install()
    this.#dispose.push(() => { void this.keepalive.close(); void this.activity.close() })
    for (const agent of ctx.agents.list()) {
      try { this.#attachKnown(agent) } catch { /* one bad child row must not abort startup */ }
    }
  }

  // ---- ownership ------------------------------------------------------

  owner(agent: Agent): CoordinatorOwner | undefined {
    const row = this.bindings.read(agent.id)
    if (row?.binding.selected) return { binding: row.binding, role: 'lead' }
    const doc = this.store.readDocument('child:' + agent.id)?.value as ChildRow | undefined
    if (!doc?.parent || !doc.taskId) return undefined
    if (doc.parent !== agent.session.header.parentSession) return undefined
    const parent = this.bindings.read(String(doc.parent))
    if (!parent?.binding.selected || String(parent.binding.taskId) !== String(doc.taskId)) return undefined
    return { binding: parent.binding, role: 'worker' }
  }

  #attachKnown(agent: Agent): void {
    const doc = this.store.readDocument('child:' + agent.id)?.value as ChildRow | undefined
    if (!doc?.parent || !doc.taskId) return
    if (doc.parent !== agent.session.header.parentSession) return
    const row = this.bindings.read(String(doc.parent))
    if (!row?.binding.selected || String(row.binding.taskId) !== String(doc.taskId)) return
    this.scopes.install(agent, row.binding, 'worker')
  }

  /**
   * M2.5 — fail-closed write boundary for the pair-mode Lead. Any tool outside
   * LEAD_LANE_TOOLS is denied: writes/edits/bash/mutating effects all route
   * through fusion_dispatch. Inner calls from run_code traverse this same guard,
   * so PTC cannot smuggle writes either.
   */
  #canExecute(exec: Readonly<ToolExecution>, role: Role): string | undefined {
    if (role !== 'lead') return undefined
    return leadLaneDeny(exec.name)
  }

  /** Explore-lane children are fenced read-only; worker lane keeps the host sandbox. */
  #readOnlyTools(agent: Agent, role: Role): readonly string[] | undefined {
    if (role !== 'worker') return undefined
    const doc = this.store.readDocument('child:' + agent.id)?.value as ChildRow | undefined
    if (doc?.lane !== 'explore') return undefined
    return EXPLORE_LANE_TOOLS.filter(name => {
      try { return Boolean(this.ctx.tools.get(name, agent.id)) } catch { return false }
    })
  }

  #denyPaused(taskId: TaskId): string | undefined {
    const runtime = readRuntime(this.store, taskId)
    return runtime?.paused
      ? bi('Fusion 已暂停（' + runtime.paused + '）— /fusion-next resume 恢复。',
           'Fusion is paused (' + runtime.paused + ') — /fusion-next resume to continue.')
      : undefined
  }

  // ---- selection lifecycle --------------------------------------------

  selectBeforeAssembly(agent: Agent, resolved: ResolvedProfile): void {
    if (agent.session.header.parentSession) return
    const row = this.bindings.read(agent.id)
    if (row?.binding.selected) { this.ensureLeadScope(agent); return }
    const taskId = TaskId('fusion-task-' + randomUUID())
    this.store.create({
      schemaVersion: 1, id: randomUUID(), taskId, seq: 1, revision: 1,
      type: 'task/created', createdAt: new Date().toISOString(), causeId: 'model-selector',
      payload: { parent: FusionSessionId(agent.id), selection: { kind: 'profile', profileId: resolved.profile.id } },
    })
    const binding = this.bindings.select(agent.id, taskId, resolved)
    createRuntime(this.store, taskId)
    this.scopes.install(agent, binding, 'lead')
  }

  /** Resumed sessions keep the binding but lose the per-process scope — the
   * guard and fusion_dispatch die with the prior process (v0.3.1 bug: a resumed
   * Lead ran naked and wrote the workspace directly). Reinstall lazily. */
  ensureLeadScope(agent: Agent): void {
    const row = this.bindings.read(agent.id)
    if (row?.binding.selected && !this.scopes.get(agent)) this.scopes.install(agent, row.binding, 'lead')
  }

  async select(agent: Agent, resolved: ResolvedProfile): Promise<void> {
    this.transport.assertAvailable()
    await agent.runMaintenance(async () => { this.selectBeforeAssembly(agent, resolved) })
  }

  async clear(agent: Agent, options: { abandon?: boolean } = {}): Promise<void> {
    const row = this.bindings.read(agent.id)
    if (row?.binding.selected) {
      const runtime = readRuntime(this.store, row.binding.taskId)
      const childId = runtime?.worker?.childId
      if (childId) {
        try { await this.transport.stop(agent, childId); await this.transport.release(agent, childId) }
        catch { /* a vanished worker is already released */ }
      }
      try { this.effects.stopJobs(row.binding.taskId) } catch { /* best-effort */ }
      try { this.keepalive.stopTask(row.binding.taskId, 'cleared') } catch { /* best-effort */ }
      updateRuntime(this.store, row.binding.taskId, rt => { rt.cleared = options.abandon ? 'abandoned' : 'cleared' })
      this.bindings.clear(agent.id)
    }
    this.scopes.detach(agent)
  }

  async pause(agent: Agent): Promise<void> {
    const row = this.bindings.read(agent.id)
    if (!row?.binding.selected) throw new Error(bi('此会话没有选中的 Fusion 配对。', 'No Fusion pair is selected in this session.'))
    const taskId = row.binding.taskId
    updateRuntime(this.store, taskId, rt => { rt.paused = 'user' })
    const childId = readRuntime(this.store, taskId)?.worker?.childId
    if (childId) {
      try { await this.transport.stop(agent, childId) } catch { /* already gone */ }
    }
    try { this.effects.stopJobs(taskId) } catch { /* best-effort */ }
    try { this.keepalive.stopTask(taskId, 'paused') } catch { /* best-effort */ }
  }

  async resume(agent: Agent): Promise<void> {
    const row = this.bindings.read(agent.id)
    if (!row?.binding.selected) throw new Error(bi('此会话没有选中的 Fusion 配对。', 'No Fusion pair is selected in this session.'))
    updateRuntime(this.store, row.binding.taskId, rt => { rt.paused = undefined })
  }

  async reconcile(agent: Agent, options: { commandId?: string; note?: string; effectsStopped?: boolean }): Promise<void> {
    const owner = this.owner(agent)
    if (!owner || owner.role !== 'lead') {
      throw new Error(bi('只有 Lead 会话可以对账任务效果。', 'Only the Lead session can reconcile task effects.'))
    }
    const taskId = owner.binding.taskId
    this.effects.assertInspection(taskId, options.effectsStopped === true)
    this.effects.inspected(taskId, options.note || 'manual reconcile', options.effectsStopped === true)
    updateRuntime(this.store, taskId, rt => { rt.paused = undefined })
  }

  state(taskId: TaskId): RuntimeV3 | undefined {
    return readRuntime(this.store, taskId)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const dispose of this.#dispose.splice(0)) { try { dispose() } catch { /* best-effort */ } }
    for (const agent of this.ctx.agents.list()) {
      try { this.scopes.detach(agent) } catch { /* best-effort */ }
    }
  }

  // ---- lead tools ------------------------------------------------------

  #installTools(scope: Context, agent: Agent, binding: SessionBinding, role: Role): readonly (() => void)[] {
    if (role !== 'lead') return []
    const coordinator = this
    const dispose: (() => void)[] = []
    dispose.push(scope.tools.register(defineTool({
      name: 'fusion_dispatch',
      description: [
        'Dispatch implementation work to the paired executor (cheap model) and collect its audited result in ONE call.',
        'The worker edits/tests inside this workspace; this call blocks until it finishes (or you are interrupted).',
        'It returns a compact audit bundle: worker summary, changed files, a bounded unified diff, static warnings, and verify-command outcomes.',
        'Failing verify commands or weakened tests trigger automatic repair rounds (same worker, max 2) before this returns.',
        'Write the instruction self-contained: what to change, where, invariants, acceptance criteria. The worker sees no chat history.',
        'Omit `instruction` only to collect a still-running worker after an interrupt. Use `reset_worker` to discard a confused worker.',
      ].join(' '),
      parameters: {
        instruction: { type: 'string', description: 'Complete implementation instruction for the executor. Required to start new work.' },
        verify_commands: { type: 'array', items: { type: 'string' }, description: 'Test-runner commands run in the workspace root after the worker finishes (pytest/vitest/jest/go/cargo/make/npm/pnpm/node/tsx/python…). Max 6. OMIT for prose/documentation tasks — inline code (node -e, python -c) is rejected.' },
        verify_timeout_ms: { type: 'number', description: 'Per-command verify timeout in ms. Clamped to [120000, 3600000]; defaults to 120000.' },
        max_wall_ms: { type: 'number', description: 'Watchdog: max wall time for this dispatch in ms (default 600000). On breach the worker is interrupted and you get a stalled bundle with full audit.' },
        max_steps: { type: 'number', description: 'Watchdog: max worker steps this dispatch may consume (default 60). On breach the worker is interrupted and you get a stalled bundle with full audit.' },
        reset_worker: { type: 'boolean', description: 'Stop and discard the current worker first (fresh context, new child session).' },
      },
      output: textOutput,
      execute: async (args, exec) => {
        const lead = exec.agent
        if (!lead) throw new Error('fusion_dispatch needs an agent context')
        const bundle = await runDispatch(
          { ctx: coordinator.ctx, store: coordinator.store, transport: coordinator.transport, activity: coordinator.activity, workerTools: coordinator.options.workerTools },
          lead, binding, args as DispatchArgs, exec.signal, exec.callId,
        )
        return JSON.stringify(bundle, null, 2)
      },
    })))
    return dispose
  }


  // ---- subagent → executor explore lane --------------------------------

  async #interceptExplore(exec: ToolExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> {
    if (exec.name !== 'subagent') return next()
    const lead = exec.agent
    if (!lead) return next()
    const owner = this.owner(lead)
    if (!owner || owner.role !== 'lead') return next()
    const args = (exec.arguments ?? {}) as { description?: string; prompt?: string; provider?: string; model?: string }
    // An explicit provider/model choice is respected — only the default path is rerouted.
    if (args.provider || args.model) return next()
    const worker = owner.binding.profile.worker
    if (!worker?.model) return next()
    const subagents = this.ctx.subagents as SubagentSeam
    if (typeof subagents.startActivation !== 'function') {
      throw new Error(bi(
        '宿主不支持子代理激活接口（需要 startActivation）— 请直接使用 read/grep 等只读工具自行探索。',
        'Host subagent activation seam is unavailable (startActivation missing) — explore directly with read/grep instead.'))
    }
    const childId = SessionId(randomUUID())
    // Child doc BEFORE the spawn: agent/created installs the explore scope off this row.
    this.store.writeDocument('child:' + String(childId), 0, { parent: lead.id, taskId: String(owner.binding.taskId), lane: 'explore' })
    const prompt = [{ type: 'text' as const, text: [
      '[Read-only exploration — executor lane]',
      String(args.description ?? ''),
      '',
      String(args.prompt ?? ''),
      '',
      'Constraints: READ and SEARCH only. Never modify files, never run mutating commands.',
      'Answer compactly with file:line evidence the Lead can act on.',
    ].join('\n') }]
    const agentOptions: { provider: string; model: string; reasoningEffort?: ReasoningEffortId } = {
      provider: worker.provider, model: worker.model,
      ...(worker.reasoningEffort ? { reasoningEffort: ReasoningEffortId(worker.reasoningEffort) } : {}),
    }
    const maxDepth = (lead.session.header.delegationDepth ?? 0) + 1
    const accepted = await subagents.startActivation({
      provider: 'spawn', label: String(args.description || 'explore'), childId, delivery: 'parent',
      parent: lead, prompt, agentOptions, maxDepth,
      request: { parent: lead, prompt, agentOptions, maxDepth },
      signal: exec.signal,
    })
    try { this.activity.link(lead.session, String(childId), String(owner.binding.taskId), exec.callId) } catch { /* best-effort */ }
    return {
      isError: false,
      value: { kind: 'activation', subagentId: String(accepted.childId) },
      content: [{ type: 'text' as const, text: bi(
        '只读探索已改派到执行模型 ' + worker.model + ' — 结果会自动回报，期间你可以继续。',
        'Read-only explorer rerouted to the executor ' + worker.model + ' — its report lands automatically; keep going.') }],
    } as ToolExecutionResult
  }
}
