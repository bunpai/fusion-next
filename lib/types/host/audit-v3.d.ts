import { type WorkspaceSnapshot } from './workspace.js';
/**
 * Deterministic post-dispatch audit — replaces the legacy verbatim-gating +
 * review-ticket ceremony. The Lead never sees raw file dumps or test stacks:
 * it receives this bounded bundle (diff <= 12k chars, tails <= 1.2k chars)
 * and decides whether to accept, rework through another fusion_dispatch, or stop.
 */
export interface VerificationRecord {
    readonly command: string;
    readonly exitCode: number;
    readonly summary: string;
    readonly failureTail?: string;
}
export interface StaticAuditResult {
    /** Existing test/spec files the worker touched — Lead checks intent vs diff. */
    readonly mutatedExistingTestFiles: readonly string[];
    /** Lines deleted from tracked test files (git only; -1 when not measurable). */
    readonly deletedTestLines: number;
    /** Quoted literals from the instruction absent from every changed file. */
    readonly missingPromptLiterals: readonly string[];
}
export interface AuditBundle {
    workerStatus: 'completed' | 'failed' | 'interrupted' | 'running' | 'stalled' | 'quarantined';
    workerSummary: string;
    changedFiles: readonly string[];
    unifiedDiff?: string;
    staticAudits: StaticAuditResult;
    verification: readonly VerificationRecord[];
    repairRounds: number;
    note?: string;
    /** M2.1 advisory: the instruction looked like a cosmetic resend of the last failed one. */
    resendSuspect?: boolean;
    /** M2.3: watchdog break details — limit tripped and budget consumed. */
    stall?: {
        reason: 'steps' | 'wall';
        budgetUsed: {
            steps: number;
            wallMs: number;
        };
    };
    /** M2.3: last observed child tool call at interruption. */
    lastActivity?: string;
}
export declare const DIFF_CAP = 12000;
export declare const TEST_PATH: RegExp;
export declare function isGitWorkspace(root: string): boolean;
/**
 * Unified diff for the Lead's review. Git path: `git diff HEAD` covers
 * tracked edits; untracked files arrive inline (bounded). Non-git workspaces
 * get no diff — changedFiles still reports the snapshot-level path set.
 */
export declare function collectDiff(root: string, changed: readonly string[], userBaseline?: ReadonlyMap<string, string>): Promise<string | undefined>;
/** Quoted spans the instruction explicitly required (backtick / single / double), 6-120 chars. */
export declare function instructionLiterals(instruction: string): readonly string[];
/**
 * Static warnings — never gates, always advisory:
 * 1. mutating an existing test file (especially deleting its lines) is the
 *    classic worker cheat; surfaced for Lead judgement, not auto-denied.
 * 2. literals the instruction quoted but no changed file contains.
 */
export declare function staticAudit(root: string, base: WorkspaceSnapshot | undefined, changed: readonly string[], instruction: string): Promise<StaticAuditResult>;
/** M2.2: per-command timeout clamps into this window; defaults to 120s. */
export declare const VERIFY_TIMEOUT_MIN_MS = 120000;
export declare const VERIFY_TIMEOUT_MAX_MS = 3600000;
export interface VerifyOptions {
    readonly verifyTimeoutMs?: number;
}
/** Segment on && ; || | (naive split — quotes are rare in verify commands and a
 * false positive here only costs a rejection, never an execution). */
export declare function validateVerifyCommand(command: string): string | undefined;
/** Run the caller-supplied verify commands serially; each bounded by verifyTimeoutMs. */
export declare function runVerification(root: string, commands: readonly string[], options?: VerifyOptions): Promise<readonly VerificationRecord[]>;
/** Diff + snapshot compare used by dispatch; shared so repair rounds reuse it. */
export declare function auditWorkspace(input: {
    root: string;
    base: WorkspaceSnapshot | undefined;
    candidate: WorkspaceSnapshot | undefined;
    instruction: string;
    /** M2.3: path → user-dirty content at dispatch-begin (three-way attribution). */
    userBaseline?: ReadonlyMap<string, string>;
}): Promise<{
    changedFiles: readonly string[];
    unifiedDiff?: string;
    staticAudits: StaticAuditResult;
}>;
