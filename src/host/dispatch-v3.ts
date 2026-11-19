import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SqliteFusionStore } from '../task/sqlite-store.js'
import type { SessionBinding } from './bindings.js'
import type { NativeWorkerTransport } from './native-worker.js'
import type { NativeFusionActivity } from './native-activity.js'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotWorkspace, type WorkspaceSnapshot } from './workspace.js'
import { auditWorkspace, runVerification, validateVerifyCommand, type AuditBundle } from './audit-v3.js'
import { beginDispatch, finishDispatch, readRuntime, updateRuntime, liveDispatch, instructionHash, instructionSimilarity, executionFailures, lastFailedDispatch } from './runtime-v3.js'

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
  /** Per-command verify timeout in ms; clamped to [120s, 3600s]. */
  readonly verify_timeout_ms?: number
  /** M2.3 watchdog: max wall time for the whole dispatch (default 600_000). */
  readonly max_wall_ms?: number
  /** M2.3 watchdog: max worker steps this dispatch may consume (default 60). */
  readonly max_steps?: number
}

export interface DispatchDeps {
  readonly ctx: Context
  readonly store: SqliteFusionStore
  readonly transport: NativeWorkerTransport
  readonly activity: NativeFusionActivity
  readonly workerTools: readonly string[]
}

const MAX_REPAIR_ROUNDS = 2
/** M2.1: rework budget (worker-side failures) and infra-attempt caps per task. */
const MAX_EXECUTION_FAILURES = 3
const MAX_INFRA_ATTEMPTS = 2
const MAX_TOTAL_ATTEMPTS = 6
const RESEND_JACCARD = 0.8
/** M2.3 watchdog defaults. */
const DEFAULT_MAX_WALL_MS = 600_000
const DEFAULT_MAX_STEPS = 60
/** M2.6: execution mutex — at most one running dispatch per task. */
const inflight = new Set<string>()
/** Provider-level failure fingerprints (429/5xx/network timeout), not rework. */
const INFRA_ERROR = /429|rate.?limit|quota|timed?\s*out|timeout|ECONN|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|\b5\d\d\b|unavailable|overloaded/i

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

/** M0 instrumentation: worker turn count = assistant messages in the child session. */
function workerStepCount(child: Agent): number {
  let count = 0
  for (const event of child.session.snapshotEvents()) if (event.type === 'assistant/message') count += 1
  return count
}

/** Durable user-turn epoch: the number of user messages the lead session has
 *  recorded so far. Survives process restarts (headless resume = new process)
 *  because it reads the persisted session event log, not in-memory state. */
function userTurnEpoch(agent: Agent): number {
  let count = 0
  for (const event of agent.session.snapshotEvents()) if (event.type === 'user/message') count += 1
  return count
}

const EMPTY_AUDITS = { mutatedExistingTestFiles: [], deletedTestLines: -1, missingPromptLiterals: [] } as const

/** M2.3 three-way attribution: files already modified vs HEAD when the dispatch
 * begins are the USER's pending edits — worker deltas on top of them must be
 * diffed against this captured content, not against HEAD. */
export function captureUserBaseline(root: string): Map<string, string> | undefined {
  try {
    const out = execFileSync('git', ['-C', root, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const names = out.split('\n').map(line => line.trim()).filter(Boolean)
    if (!names.length) return undefined
    const baseline = new Map<string, string>()
    for (const name of names.slice(0, 64)) {
      try {
        const buf = readFileSync(join(root, name))
        if (buf.length <= 512 * 1024) baseline.set(name, buf.toString('utf8'))
      } catch { /* unreadable/binary file — attribution falls back to ambiguous */ }
    }
    return baseline.size ? baseline : undefined
  } catch { return undefined } // not a git worktree — diff attribution stays undefined
}

function rejectedBundle(note: string): AuditBundle {
  return { workerStatus: 'failed', workerSummary: '', changedFiles: [], staticAudits: EMPTY_AUDITS, verification: [], repairRounds: 0, note }
}

/** M2.3: name + arg-head of the child's most recent tool call, for stall forensics. */
function lastToolActivity(child: Agent | undefined): string | undefined {
  if (!child) return undefined
  const event = child.session.snapshotEvents().findLast(e => /tool/i.test(e.type))
  const data = (event?.data ?? {}) as { name?: string; arguments?: unknown; toolName?: string }
  const name = data.name ?? data.toolName
  if (!name) return undefined
  const args = JSON.stringify(data.arguments ?? {}).slice(0, 120)
  return name + '(' + args + ')'
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

  // M2.6: execution mutex — a second dispatch for the same task gets a running bundle.
  if (inflight.has(taskId)) {
    return {
      workerStatus: 'running', workerSummary: '', changedFiles: [], staticAudits: EMPTY_AUDITS,
      verification: [], repairRounds: 0,
      note: 'A dispatch for this task is already in flight — call fusion_dispatch without an instruction to collect it.',
    }
  }

  // M2.1: escalation gates — host-side, before any worker runs. Rejects are
  // recorded with status 'rejected' and never consume the rework budget.
  const hash = instruction ? instructionHash(instruction) : undefined
  const reject = (note: string): AuditBundle => {
    const rec = beginDispatch(store, taskId, instruction || '(collect pending worker)', hash ? { instructionHash: hash } : undefined)
    try { finishDispatch(store, taskId, rec.id, { status: 'rejected', error: note }) } catch { /* projection best-effort */ }
    return rejectedBundle(note)
  }
  // Turn-epoch scoping: the rework budget and infra counter belong to the
  // current user request. A new user message opens a fresh epoch — without
  // this, a stalled stretch in one question permanently bricked every later
  // dispatch in the same session (observed live in the f33 bench).
  const epoch = userTurnEpoch(agent)
  const sameEpoch = (runtime.turnEpoch ?? epoch) === epoch
  if (!sameEpoch) {
    try { updateRuntime(store, taskId, rt => { rt.turnEpoch = epoch; rt.infraAttempts = 0 }) } catch { /* best-effort */ }
  }
  const execFails = sameEpoch ? executionFailures(runtime, epoch) : 0
  const infraTries = sameEpoch ? (runtime.infraAttempts ?? 0) : 0
  if (instruction && execFails >= MAX_EXECUTION_FAILURES) {
    return reject('escalation budget exhausted — present the conflict to the user: what was tried (attempts, failing checks, worker summary) and what you recommend.')
  }
  if (instruction && execFails + infraTries >= MAX_TOTAL_ATTEMPTS) {
    return reject('attempt cap exhausted (execution + provider failures) — present the conflict to the user.')
  }
  const lastFailed = lastFailedDispatch(runtime)
  if (instruction && hash && lastFailed?.instructionHash === hash) {
    return reject('escalation rejected: identical instruction after failure — refine the instruction or surface the conflict to the user.')
  }
  const resendSuspect = Boolean(instruction && lastFailed && hash && lastFailed.instructionHash !== hash
    && instructionSimilarity(instruction, lastFailed.instruction) >= RESEND_JACCARD)

  // M2.2 preflight: a rejected verify command is a PLANNER error, not a worker
  // execution failure. Reject before any worker runs — never burns budget.
  const badVerify = (args.verify_commands ?? []).map(c => [c, validateVerifyCommand(c)] as const).find(([, r]) => r)
  if (badVerify) {
    return reject('verify command rejected by runner allowlist (does not consume the rework budget) — fix the command and re-dispatch: ' + badVerify[0] + ' — ' + badVerify[1])
  }

  const record = beginDispatch(store, taskId, instruction || '(collect pending worker)', {
    ...(hash ? { instructionHash: hash } : {}),
    ...(resendSuspect ? { resendSuspect: true } : {}),
    epoch,
  })
  inflight.add(taskId)
  const t0 = Date.now()
  const stepBase = (() => {
    const child = childId ? ctx.agents.get(SessionId(childId)) : undefined
    return child ? workerStepCount(child) : 0
  })()
  const finish = (patch: Parameters<typeof finishDispatch>[3]) => {
    try { finishDispatch(store, taskId, record.id, { wallMs: Date.now() - t0, ...patch }) } catch { /* status projection is best-effort */ }
  }

  // M2.3: baseline BEFORE the instruction reaches the worker — early worker
  // writes can no longer escape the diff attribution window. The user baseline
  // (files already dirty vs HEAD) is captured in the same instant so worker
  // changes on top of uncommitted user edits are attributed three-way.
  const base: WorkspaceSnapshot | undefined = root ? snapshotWorkspace(root) : undefined
  const userBaseline = root ? captureUserBaseline(root) : undefined

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
    let repairRounds = 0
    const maxWallMs = args.max_wall_ms ?? DEFAULT_MAX_WALL_MS
    const maxSteps = args.max_steps ?? DEFAULT_MAX_STEPS
    for (;;) {
      // M2.3 watchdog: poll worker step count + wall clock on a private abort
      // channel; on breach interrupt, re-settle for quiescence, then run the
      // FULL audit pipeline — a half-edited workspace is only actionable when
      // the Lead can see exactly where it broke. No repair loop after stall.
      const stallCtl = new AbortController()
      const onParentAbort = () => stallCtl.abort()
      signal.addEventListener('abort', onParentAbort, { once: true })
      let stall: { reason: 'steps' | 'wall'; budgetUsed: { steps: number; wallMs: number } } | undefined
      const watchdog = setInterval(() => {
        const live = childId ? ctx.agents.get(SessionId(childId)) : undefined
        const steps = live ? Math.max(0, workerStepCount(live) - stepBase) : 0
        const wallMs = Date.now() - t0
        if (steps >= maxSteps) stall = { reason: 'steps', budgetUsed: { steps, wallMs } }
        else if (wallMs >= maxWallMs) stall = { reason: 'wall', budgetUsed: { steps, wallMs } }
        if (stall) stallCtl.abort()
      }, 5_000)
      let child: Agent | undefined
      try {
        child = await transport.settle(agent, childId!, stallCtl.signal, true)
      } catch (settleError) {
        if (!stall) throw settleError
      } finally {
        clearInterval(watchdog)
        signal.removeEventListener('abort', onParentAbort)
      }
      if (stall) {
        const interruptedChild = childId ? ctx.agents.get(SessionId(childId)) : undefined
        const lastActivity = lastToolActivity(interruptedChild)
        let quiesced: Agent | undefined
        try {
          await transport.interruptAndContinue(agent, childId!, '[fusion-next watchdog] ' + stall.reason + ' budget exhausted (' + (stall.reason === 'steps' ? stall.budgetUsed.steps + ' steps' : Math.round(stall.budgetUsed.wallMs / 1000) + 's wall') + ') — stop now and report partial progress.', signal)
          quiesced = await transport.settle(agent, childId!, signal, true)
        } catch { quiesced = undefined }
        if (!quiesced) {
          finish({ status: 'quarantined', stall, lastActivity, error: 'worker did not quiesce after watchdog interrupt' })
          return {
            workerStatus: 'quarantined',
            workerSummary: '(worker did not quiesce after the watchdog interrupt — it may still hold half-written state; inspect or reset before dispatching again)',
            changedFiles: [], staticAudits: EMPTY_AUDITS, verification: [], repairRounds,
            stall, lastActivity,
            note: 'Quarantined: no audit taken because worker state is unknown — the dirty workspace was NOT recorded as fact.',
          }
        }
        const stalledSummary = workerSummary(quiesced)
        const stalledCandidate = root ? snapshotWorkspace(root) : undefined
        const audited = root
          ? await auditWorkspace({ root, base, candidate: stalledCandidate, instruction, userBaseline })
          : { changedFiles: [] as readonly string[], unifiedDiff: undefined, staticAudits: EMPTY_AUDITS }
        const stalledVerification = args.verify_commands?.length && root
          ? await runVerification(root, args.verify_commands, { verifyTimeoutMs: args.verify_timeout_ms })
          : []
        const stalledBundle: AuditBundle = {
          workerStatus: 'stalled', workerSummary: stalledSummary,
          changedFiles: audited.changedFiles, unifiedDiff: audited.unifiedDiff, staticAudits: audited.staticAudits,
          verification: stalledVerification, repairRounds, stall, lastActivity,
          note: 'Workspace may be half-edited — the diff shows the dirty state; verify results show the current breakage. The worker session is preserved; send a targeted delta or reset it.',
        }
        finish({
          status: 'stalled', changedFiles: audited.changedFiles, stall, lastActivity,
          checks: stalledVerification.map(({ command, exitCode, summary: s }) => ({ command, exitCode, summary: s })),
          bundleBytes: JSON.stringify(stalledBundle).length,
        })
        return stalledBundle
      }
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
      const workerSteps = Math.max(0, workerStepCount(child) - stepBase)
      const candidate = root ? snapshotWorkspace(root) : undefined
      const { changedFiles, unifiedDiff, staticAudits } = root
        ? await auditWorkspace({ root, base, candidate, instruction, userBaseline })
        : { changedFiles: [] as readonly string[], unifiedDiff: undefined, staticAudits: { mutatedExistingTestFiles: [], deletedTestLines: -1, missingPromptLiterals: [] } }
      const verification = args.verify_commands?.length && root
        ? await runVerification(root, args.verify_commands, { verifyTimeoutMs: args.verify_timeout_ms })
        : []
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
      const bundle: AuditBundle = {
        workerStatus: status === 'failed' ? 'failed' : 'completed',
        workerSummary: summary, changedFiles, unifiedDiff, staticAudits, verification, repairRounds,
        ...(resendSuspect ? { resendSuspect: true, note: 'instruction resembles the previous failed one — name the new information or change strategy' } : {}),
      }
      finish({
        status, changedFiles, workerSteps,
        checks: verification.map(({ command, exitCode, summary: s }) => ({ command, exitCode, summary: s })),
        warnings, repairRounds,
        bundleBytes: JSON.stringify(bundle).length,
        ...(failures.length ? { error: failures[0].command + ' exited ' + failures[0].exitCode, failureSignature: failures[0].command + '@' + failures[0].exitCode } : {}),
      })
      return bundle
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // An aborted settle means the worker OUTLIVED this call — record it so the
    // next dispatch reattaches instead of spawning a duplicate worker.
    if (!signal.aborted && INFRA_ERROR.test(message)) {
      // Provider-level failure: does NOT consume the rework budget, counts as
      // infra attempts. Never auto-rebind — the binding is the user's call.
      finish({ status: 'infra', error: message })
      try { updateRuntime(store, taskId, rt => { rt.infraAttempts = ((rt.turnEpoch === epoch ? rt.infraAttempts : 0) ?? 0) + 1; rt.turnEpoch = epoch }) } catch { /* best-effort */ }
      const tries = (readRuntime(store, taskId)?.infraAttempts ?? 0)
      const stillAlive = await childAlive(ctx, agent, childId).catch(() => false)
      const suffix = tries >= MAX_INFRA_ATTEMPTS
        ? ' Consider asking the user about switching the worker binding.'
        : ' If this was a timeout, the worker may still be executing — call fusion_dispatch without an instruction to collect it before resending.'
      return {
        workerStatus: stillAlive ? 'running' : 'failed',
        workerSummary: '', changedFiles: [], staticAudits: EMPTY_AUDITS, verification: [], repairRounds: 0,
        note: 'provider unavailable: ' + message.slice(0, 300) + ' (infra attempt ' + tries + '/' + MAX_TOTAL_ATTEMPTS + ' — not counted against the rework budget).' + suffix,
      }
    }
    finish({ status: 'interrupted', error: message })
    throw error
  } finally {
    inflight.delete(taskId)
  }
}

/** Live-dispatch check for the prefix router: worker work in flight keeps the Lead streaming. */
export function dispatchInFlight(store: SqliteFusionStore, taskId: import('../contracts.js').TaskId): boolean {
  try { return Boolean(liveDispatch(readRuntime(store, taskId))) } catch { return true }
}
