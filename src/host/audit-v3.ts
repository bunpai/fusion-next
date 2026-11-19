import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
import { changedPaths, workspacePath, type WorkspaceSnapshot } from './workspace.js'

/**
 * Deterministic post-dispatch audit — replaces the legacy verbatim-gating +
 * review-ticket ceremony. The Lead never sees raw file dumps or test stacks:
 * it receives this bounded bundle (diff <= 12k chars, tails <= 1.2k chars)
 * and decides whether to accept, rework through another fusion_dispatch, or stop.
 */

export interface VerificationRecord {
  readonly command: string
  readonly exitCode: number
  readonly summary: string
  readonly failureTail?: string
}

export interface StaticAuditResult {
  /** Existing test/spec files the worker touched — Lead checks intent vs diff. */
  readonly mutatedExistingTestFiles: readonly string[]
  /** Lines deleted from tracked test files (git only; -1 when not measurable). */
  readonly deletedTestLines: number
  /** Quoted literals from the instruction absent from every changed file. */
  readonly missingPromptLiterals: readonly string[]
}

export interface AuditBundle {
  workerStatus: 'completed' | 'failed' | 'interrupted' | 'running' | 'stalled' | 'quarantined'
  workerSummary: string
  changedFiles: readonly string[]
  unifiedDiff?: string
  staticAudits: StaticAuditResult
  verification: readonly VerificationRecord[]
  repairRounds: number
  note?: string
  /** M2.1 advisory: the instruction looked like a cosmetic resend of the last failed one. */
  resendSuspect?: boolean
  /** M2.3: watchdog break details — limit tripped and budget consumed. */
  stall?: { reason: 'steps' | 'wall'; budgetUsed: { steps: number; wallMs: number } }
  /** M2.3: last observed child tool call at interruption. */
  lastActivity?: string
}


export const DIFF_CAP = 12_000
const UNTRACKED_CAP = 6
const UNTRACKED_BYTES = 8 * 1024
const FILE_READ_CAP = 256 * 1024
const VERIFY_TIMEOUT_MS = 120_000
const VERIFY_MAX = 6
const LITERAL_MAX = 20
export const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|_test\.go$|test_.*\.py$/i

interface ExecOut { code: number; out: string }

const run = (file: string, args: readonly string[], cwd: string, timeoutMs = 30_000): Promise<ExecOut> =>
  new Promise(resolve => {
    execFile(file, [...args], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
      resolve({ code, out: String(stdout ?? '') + (stderr ? '\n' + String(stderr) : '') })
    })
  })

const tail = (text: string, chars: number): string => (text.length <= chars ? text : '…' + text.slice(-chars))
const cap = (text: string, chars: number): string =>
  (text.length <= chars ? text : text.slice(0, chars) + '\n…[diff truncated at ' + chars + ' chars]')

export function isGitWorkspace(root: string): boolean {
  return existsSync(join(root, '.git'))
}

/**
 * Unified diff for the Lead's review. Git path: `git diff HEAD` covers
 * tracked edits; untracked files arrive inline (bounded). Non-git workspaces
 * get no diff — changedFiles still reports the snapshot-level path set.
 */
export async function collectDiff(root: string, changed: readonly string[], userBaseline?: ReadonlyMap<string, string>): Promise<string | undefined> {
  if (!isGitWorkspace(root)) return undefined
  const parts: string[] = []
  const tracked = await run('git', ['diff', '--name-only', 'HEAD', '--'], root)
  const trackedSet = new Set(tracked.out.split('\n').map(line => line.trim()).filter(Boolean))
  const status = await run('git', ['status', '--porcelain=v1'], root)
  const untrackedSet = new Set(status.out.split('\n')
    .map(line => line.match(/^\?\?\s+(.+)$/)?.[1]?.trim().replace(/^"|"$/g, ''))
    .filter((path): path is string => Boolean(path)))
  // M2.3 three-way attribution: files the USER had already modified vs HEAD at
  // dispatch-begin carry a captured baseline — the reported diff is baseline →
  // current (the worker's net increment), never HEAD → current. Untouched user
  // files stay out entirely. Unattributable cases are marked ambiguous.
  for (const path of changed.slice(0, 32)) {
    const baseline = userBaseline?.get(path)
    if (baseline !== undefined) {
      const current = await readFile(workspacePath(root, path), 'utf8').catch(() => undefined)
      if (current === undefined) { parts.push('ambiguous: ' + path + ' (user-modified file now unreadable — attribution lost)') ; continue }
      if (current === baseline) continue // user-dirty, worker no-op
      const tmp = join(tmpdir(), 'fusion-ub-' + randomUUID())
      try {
        await writeFile(tmp, baseline)
        const diff = await run('git', ['diff', '--no-index', '--', tmp, workspacePath(root, path)], '/')
        const relabeled = diff.out
          .split('\n')
          .map(line => line.startsWith('--- ') ? '--- a/' + path + ' (user-dirty baseline)'
                     : line.startsWith('+++ ') ? '+++ b/' + path
                     : line.replace(tmp, 'a/' + path).replace(workspacePath(root, path), 'b/' + path))
          .join('\n')
        if (relabeled.trim()) parts.push(relabeled)
      } finally { await unlink(tmp).catch(() => {}) }
      continue
    }
    if (userBaseline && !userBaseline.has(path) && !trackedSet.has(path) && untrackedSet.has(path)) {
      // fall through to untracked inline below
    }
    if (trackedSet.has(path)) {
      const diff = await run('git', ['-c', 'color.ui=false', 'diff', 'HEAD', '--', path], root)
      if (diff.out.trim()) parts.push(diff.out)
      continue
    }
    if (untrackedSet.has(path)) {
      try {
        const body = await readFile(workspacePath(root, path), 'utf8')
        const text = body.length > UNTRACKED_BYTES ? body.slice(0, UNTRACKED_BYTES) + '\n…[file truncated]' : body
        parts.push('--- /dev/null\n+++ b/' + path + '\n' + text.split('\n').map(line => '+' + line).join('\n'))
      } catch { /* unreadable new file — still listed in changedFiles */ }
      continue
    }
    parts.push('ambiguous: ' + path + ' (snapshot digest changed but git shows no tracked/untracked delta — mode, rename, or symlink)')
  }
  const joined = parts.join('\n')
  return joined.trim() ? cap(joined, DIFF_CAP) : undefined
}

/** Quoted spans the instruction explicitly required (backtick / single / double), 6-120 chars. */
export function instructionLiterals(instruction: string): readonly string[] {
  const found = new Set<string>()
  const pattern = new RegExp('[`' + '\'"\\s]*([`' + '\'"])(.{6,120}?)\\1', 'g')
  for (const match of instruction.matchAll(pattern)) {
    const text = match[2].trim()
    if (!text || /\s{3,}/.test(text) || text.includes('\n')) continue
    found.add(text)
    if (found.size >= LITERAL_MAX) break
  }
  return [...found]
}

const readCapped = async (root: string, path: string): Promise<string | undefined> => {
  try {
    const body = await readFile(workspacePath(root, path), 'utf8')
    return body.length > FILE_READ_CAP ? body.slice(0, FILE_READ_CAP) : body
  } catch { return undefined }
}

/**
 * Static warnings — never gates, always advisory:
 * 1. mutating an existing test file (especially deleting its lines) is the
 *    classic worker cheat; surfaced for Lead judgement, not auto-denied.
 * 2. literals the instruction quoted but no changed file contains.
 */
export async function staticAudit(
  root: string,
  base: WorkspaceSnapshot | undefined,
  changed: readonly string[],
  instruction: string,
): Promise<StaticAuditResult> {
  const basePaths = new Set(base?.entries.map(entry => entry.path) ?? [])
  const mutatedExistingTestFiles = changed.filter(path => TEST_PATH.test(path) && basePaths.has(path))
  let deletedTestLines = -1
  if (mutatedExistingTestFiles.length && isGitWorkspace(root)) {
    deletedTestLines = 0
    const numstat = await run('git', ['diff', '--numstat', 'HEAD', '--', ...mutatedExistingTestFiles], root)
    for (const line of numstat.out.split('\n')) {
      const cols = line.trim().split(/\s+/)
      const removed = Number(cols[1])
      if (Number.isFinite(removed)) deletedTestLines += removed
    }
  }
  const missingPromptLiterals: string[] = []
  const literals = instructionLiterals(instruction)
  if (literals.length && changed.length) {
    const contents: string[] = []
    for (const path of changed.slice(0, 24)) {
      const text = await readCapped(root, path)
      if (text !== undefined) contents.push(text)
    }
    const haystack = contents.join('\n')
    for (const literal of literals) if (!haystack.includes(literal)) missingPromptLiterals.push(literal)
  }
  return { mutatedExistingTestFiles, deletedTestLines, missingPromptLiterals }
}

/** M2.2: per-command timeout clamps into this window; defaults to 120s. */
export const VERIFY_TIMEOUT_MIN_MS = 120_000
export const VERIFY_TIMEOUT_MAX_MS = 3_600_000

export interface VerifyOptions {
  readonly verifyTimeoutMs?: number
}

const clampVerifyTimeout = (ms: number | undefined): number =>
  Math.min(VERIFY_TIMEOUT_MAX_MS, Math.max(VERIFY_TIMEOUT_MIN_MS, ms ?? VERIFY_TIMEOUT_MS))

/** M2.2 runner allowlist — first token of every command segment must be a test
 * runner / build tool; inline interpreter code (-c/-e/exec), file redirection,
 * and deterministic-danger patterns are rejected BEFORE the shell sees them. */
const VERIFY_RUNNERS = new Set([
  'pytest', 'py.test', 'python', 'python3', 'vitest', 'jest', 'mocha', 'tap', 'ava',
  'go', 'cargo', 'make', 'tsc', 'tox', 'nox',
  'npm', 'pnpm', 'yarn', 'bun', 'deno', 'npx', 'pnpm exec',
  'node', 'tsx', 'ts-node',
])
const VERIFY_DANGER = /rm\s+-[rf]{1,2}|sudo|mkfs|dd\s+if=|>\/dev\/|curl[^|]*\|\s*(sh|bash)|wget[^|]*\|\s*(sh|bash)|chmod\s+-R\s+777|killall|shutdown|reboot/i
const INLINE_INTERPRETER = /(^|\s)(-c|-e|--eval|eval|exec)\b/

/** Segment on && ; || | (naive split — quotes are rare in verify commands and a
 * false positive here only costs a rejection, never an execution). */
export function validateVerifyCommand(command: string): string | undefined {
  if (VERIFY_DANGER.test(command)) return 'rejected: matches a destructive-command pattern'
  if (/[<>]/.test(command.replace(/->/g, ''))) return 'rejected: file redirection is not a verification'
  const segments = command.split(/&&|\|\||;|\|/g).map(segment => segment.trim()).filter(Boolean)
  for (const segment of segments) {
    const token = segment.split(/\s+/)[0] ?? ''
    const base = token.replace(/^\.\//, '').replace(/^.*\//, '')
    if (INLINE_INTERPRETER.test(segment)) return 'rejected: inline interpreter code (-c/-e/exec) is not a verification'
    if (VERIFY_RUNNERS.has(base) || VERIFY_RUNNERS.has(token)) continue
    if (/\.(sh|bash|zsh|py|rb)$/.test(base)) continue // project-local scripts
    return 'rejected: `' + token + '` is not in the verify-runner allowlist (pytest/vitest/jest/mocha/go/cargo/make/tsc/tox/npm/pnpm/yarn/node/tsx or a package script)'
  }
  return undefined
}

/** Run the caller-supplied verify commands serially; each bounded by verifyTimeoutMs. */
export async function runVerification(root: string, commands: readonly string[], options?: VerifyOptions): Promise<readonly VerificationRecord[]> {
  const records: VerificationRecord[] = []
  const timeout = clampVerifyTimeout(options?.verifyTimeoutMs)
  for (const command of commands.slice(0, VERIFY_MAX)) {
    const rejected = validateVerifyCommand(command)
    if (rejected) {
      records.push({ command, exitCode: 126, summary: rejected })
      continue
    }
    const { code, out } = await run('bash', ['-lc', command], root, timeout)
    records.push(code === 0
      ? { command, exitCode: 0, summary: tail(out.trim() || 'exit 0', 300) }
      : { command, exitCode: code, summary: tail(out.trim() || 'exit ' + code, 300), failureTail: tail(out.trim(), 1200) })
  }
  return records
}

/** Diff + snapshot compare used by dispatch; shared so repair rounds reuse it. */
export async function auditWorkspace(input: {
  root: string
  base: WorkspaceSnapshot | undefined
  candidate: WorkspaceSnapshot | undefined
  instruction: string
  /** M2.3: path → user-dirty content at dispatch-begin (three-way attribution). */
  userBaseline?: ReadonlyMap<string, string>
}): Promise<{ changedFiles: readonly string[]; unifiedDiff?: string; staticAudits: StaticAuditResult }> {
  const { root, base, candidate, instruction, userBaseline } = input
  const changedFiles = base && candidate ? changedPaths(base, candidate) : []
  const [unifiedDiff, staticAudits] = await Promise.all([
    collectDiff(root, changedFiles, userBaseline),
    staticAudit(root, base, changedFiles, instruction),
  ])
  return { changedFiles, unifiedDiff, staticAudits }
}
