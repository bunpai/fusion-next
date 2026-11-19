import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SqliteFusionStore } from '../task/sqlite-store.js'
import type { SessionBinding } from './bindings.js'
import type { NativeWorkerTransport } from './native-worker.js'
import type { NativeFusionActivity } from './native-activity.js'
import { snapshotWorkspace, type WorkspaceSnapshot } from './workspace.js'
import { auditWorkspace, runVerification, type AuditBundle } from './audit-v3.js'
import { beginDispatch, finishDispatch, readRuntime, updateRuntime, liveDispatch } from './runtime-v3.js'

/**
 * fusion_dispatch — the single Lead→Worker handoff. Replaces the legacy
 * delegate/rework/wait/submit_result ceremony: one tool call starts or
 * continues the durable worker child, blocks on settle() inside the call
 * (no 75s poll, no split turns), audits the workspace deterministically,
 * self-repairs verification failures through the same worker, and returns
 * a bounded AuditBundle the Lead reviews in one step.
 */
export interface DispatchArgs {
  readonly instruction?: string
  readonly verify_commands?: readonly string[]
  readonly reset_worker?: boolean
}

export interface DispatchDeps {
  readonly ctx: Context
  readonly store: SqliteFusionStore
  readonly transport: NativeWorkerTransport
  readonly activity: NativeFusionActivity
  readonly workerTools: readonly string[]
}

const MAX_REPAIR_ROUNDS = 2

const WORKER_BRIEF_HEADER = [
  '# Work order',
  'Implement the instruction below directly in this workspace.',
  '',
  'Rules:',
  '- Act, do not ask. If something is ambiguous, pick the most reasonable interpretation and note it in your report.',
  '- Preserve every literal, identifier, and requirement from the instruction exactly.',
  '- NEVER weaken, delete, skip, or rewrite existing tests. If a test fails, fix the implementation.',
  '- Batch your tool calls: read/edit/test in as few steps as you safely can.',
  '- Verify the change yourself before ending your turn (typecheck/build/tests that apply).',
  '- End your turn with a compact report: files changed, verification performed, anything left undone.',
  '',
  '# Instruction',
].join('\n')

const repairBrief = (failures: readonly string[], warnings: readonly string[]): string => [
  'The automated audit of your previous work found problems. Fix the implementation — do NOT edit or weaken the tests, do not work around the failing commands.',
  '',
  ...failures,
  ...warnings.map(warning => 'Warning: ' + warning),
  '',
  'When fixed, end your turn with a compact report.',
].join('\n')

function workerSummary(child: Agent): string {
  const last = child.session.snapshotEvents().findLast(event => event.type === 'assistant/message' && !event.data.interrupted)
  const content = last?.type === 'assistant/message' ? last.data.message.content : []
  const text = (content as readonly { type?: string; text?: string }[])
    .filter(block => block.type === 'text')
    .map(block => String(block.text ?? ''))
    .join('\n')
    .trim()
  return text || '(worker ended without a final report)'
}

async function childAlive(ctx: Context, parent: Agent, childId: string | undefined): Promise<boolean> {
  if (!childId) return false
  const child = ctx.agents.get(SessionId(childId))
  return Boolean(child && child.session.header.parentSession === parent.id && (child.status === 'idle' || child.status === 'running'))
}

export async function runDispatch(
  deps: DispatchDeps,
  agent: Agent,
  binding: SessionBinding,
  args: DispatchArgs,
  signal: AbortSignal,
  callId?: string,
): Promise<AuditBundle> {
  const { ctx, store, transport, activity, workerTools } = deps
  const taskId = binding.taskId
  const runtime = readRuntime(store, taskId)
  if (runtime?.paused) throw new Error('Fusion is paused — resume with /fusion-next resume before dispatching.')
  if (!runtime) throw new Error('Fusion runtime missing; reselect the pair.')
  const root = agent.session.header.cwd
  const instruction = (args.instruction ?? '').trim()
  const reset = args.reset_worker === true

  // ---- worker lifecycle ------------------------------------------------
  let childId = runtime.worker?.childId
  if (reset && childId) {
    try {
      await transport.stop(agent, childId)
      await transport.release(agent, childId)
    } catch { /* a vanished child is already released */ }
    childId = undefined
    updateRuntime(store, taskId, rt => { rt.worker = undefined })
  }
  const alive = await childAlive(ctx, agent, childId)
  if (!alive && !instruction) {
    throw new Error(childId
      ? 'The worker session is gone — call fusion_dispatch with reset_worker:true and an instruction to start a fresh one.'
      : 'fusion_dispatch needs an instruction to start the worker.')
  }

  const record = beginDispatch(store, taskId, instruction || '(collect pending worker)')
  const finish = (patch: Parameters<typeof finishDispatch>[3]) => {
    try { finishDispatch(store, taskId, record.id, patch) } catch { /* status projection is best-effort */ }
  }

  try {
    if (!alive) {
      childId = randomUUID()
      // The child doc lands BEFORE the spawn: agent/created installs the worker
      // scope off this row, so the lane must be durable at creation time.
      store.writeDocument('child:' + childId, 0, { parent: agent.id, taskId, lane: 'worker' })
      // The host validates allowedTools against globally-registered names and
      // rejects the whole start on a miss (e.g. no pwsh outside the desktop
      // sandbox) — intersect first so a partial profile never bricks dispatch.
      const allowedTools = workerTools.filter(name => {
        try { return Boolean(ctx.tools.get(name)) } catch { return false }
      })
      await transport.start(agent, {
        childId, label: 'Fusion Worker', brief: WORKER_BRIEF_HEADER + instruction,
        route: binding.profile.worker, persona: '', allowedTools,
      }, signal)
      updateRuntime(store, taskId, rt => { rt.worker = { childId: childId! } })
    } else if (instruction) {
      await transport.continue(agent, childId!, WORKER_BRIEF_HEADER + instruction, signal)
    }
    if (callId && childId) {
      try { activity.link(agent.session, childId, String(taskId), callId) } catch { /* activity mirroring is best-effort */ }
    }

    // ---- settle + audit + auto-repair ----------------------------------
    const base: WorkspaceSnapshot | undefined = root ? snapshotWorkspace(root) : undefined
    let repairRounds = 0
    for (;;) {
      const child = await transport.settle(agent, childId!, signal, true)
      if (!child) {
        // User steered the Lead mid-wait: the worker keeps running; a later
        // fusion_dispatch (no instruction) collects it.
        finish({ status: 'steered' })
        return {
          workerStatus: 'running',
          workerSummary: '(worker still running — the user steered this session; call fusion_dispatch without instruction to collect it)',
          changedFiles: [], staticAudits: { mutatedExistingTestFiles: [], deletedTestLines: -1, missingPromptLiterals: [] },
          verification: [], repairRounds,
          note: 'Yielded to user steering; worker handoff continues in the background.',
        }
      }
      const summary = workerSummary(child)
      const candidate = root ? snapshotWorkspace(root) : undefined
      const { changedFiles, unifiedDiff, staticAudits } = root
        ? await auditWorkspace({ root, base, candidate, instruction })
        : { changedFiles: [] as readonly string[], unifiedDiff: undefined, staticAudits: { mutatedExistingTestFiles: [], deletedTestLines: -1, missingPromptLiterals: [] } }
      const verification = args.verify_commands?.length && root ? await runVerification(root, args.verify_commands) : []
      const failures = verification.filter(record => record.exitCode !== 0)
      const warnings: string[] = [
        ...staticAudits.mutatedExistingTestFiles.map(path => 'existing test file modified: ' + path),
        ...(staticAudits.deletedTestLines > 0 ? [staticAudits.deletedTestLines + ' existing test lines deleted'] : []),
        ...staticAudits.missingPromptLiterals.map(literal => 'instruction literal missing from changed files: ' + literal),
      ]
      const needsRepair = (failures.length > 0 || staticAudits.deletedTestLines > 0) && repairRounds < MAX_REPAIR_ROUNDS
      if (needsRepair && !signal.aborted) {
        repairRounds += 1
        const feedback = repairBrief(
          failures.map(record => '- `' + record.command + '` exited ' + record.exitCode + ':\n' + (record.failureTail ?? record.summary)),
          warnings,
        )
        await transport.continue(agent, childId!, feedback, signal)
        continue
      }
      const status = failures.length ? 'failed' : 'completed'
      finish({
        status, changedFiles,
        checks: verification.map(({ command, exitCode, summary: s }) => ({ command, exitCode, summary: s })),
        warnings, repairRounds,
        ...(failures.length ? { error: failures[0].command + ' exited ' + failures[0].exitCode } : {}),
      })
      return {
        workerStatus: status === 'failed' ? 'failed' : 'completed',
        workerSummary: summary, changedFiles, unifiedDiff, staticAudits, verification, repairRounds,
      }
    }
  } catch (error) {
    // An aborted settle means the worker OUTLIVED this call — record it so the
    // next dispatch reattaches instead of spawning a duplicate worker.
    finish({ status: 'interrupted', error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

/** Live-dispatch check for the prefix router: worker work in flight keeps the Lead streaming. */
export function dispatchInFlight(store: SqliteFusionStore, taskId: import('../contracts.js').TaskId): boolean {
  try { return Boolean(liveDispatch(readRuntime(store, taskId))) } catch { return true }
}
