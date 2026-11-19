import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  workerStatus: 'completed' | 'failed' | 'interrupted' | 'running'
  workerSummary: string
  changedFiles: readonly string[]
  unifiedDiff?: string
  staticAudits: StaticAuditResult
  verification: readonly VerificationRecord[]
  repairRounds: number
  note?: string
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
export async function collectDiff(root: string, _changed: readonly string[]): Promise<string | undefined> {
  if (!isGitWorkspace(root)) return undefined
  const parts: string[] = []
  const diff = await run('git', ['-c', 'color.ui=false', 'diff', 'HEAD', '--'], root)
  if (diff.out.trim()) parts.push(cap(diff.out, DIFF_CAP))
  const status = await run('git', ['status', '--porcelain=v1'], root)
  const untracked = status.out.split('\n')
    .map(line => line.match(/^\?\?\s+(.+)$/)?.[1]?.trim().replace(/^"|"$/g, ''))
    .filter((path): path is string => Boolean(path))
    .slice(0, UNTRACKED_CAP)
  for (const path of untracked) {
    try {
      const body = await readFile(workspacePath(root, path), 'utf8')
      const text = body.length > UNTRACKED_BYTES ? body.slice(0, UNTRACKED_BYTES) + '\n…[file truncated]' : body
      parts.push('--- /dev/null\n+++ b/' + path + '\n' + text.split('\n').map(line => '+' + line).join('\n'))
    } catch { /* unreadable new file — still listed in changedFiles */ }
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

/** Run the caller-supplied verify commands serially; each bounded to 120s. */
export async function runVerification(root: string, commands: readonly string[]): Promise<readonly VerificationRecord[]> {
  const records: VerificationRecord[] = []
  for (const command of commands.slice(0, VERIFY_MAX)) {
    const { code, out } = await run('bash', ['-lc', command], root, VERIFY_TIMEOUT_MS)
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
}): Promise<{ changedFiles: readonly string[]; unifiedDiff?: string; staticAudits: StaticAuditResult }> {
  const { root, base, candidate, instruction } = input
  const changedFiles = base && candidate ? changedPaths(base, candidate) : []
  const [unifiedDiff, staticAudits] = await Promise.all([
    collectDiff(root, changedFiles),
    staticAudit(root, base, changedFiles, instruction),
  ])
  return { changedFiles, unifiedDiff, staticAudits }
}
