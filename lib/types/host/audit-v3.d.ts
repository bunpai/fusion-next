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
    workerStatus: 'completed' | 'failed' | 'interrupted' | 'running';
    workerSummary: string;
    changedFiles: readonly string[];
    unifiedDiff?: string;
    staticAudits: StaticAuditResult;
    verification: readonly VerificationRecord[];
    repairRounds: number;
    note?: string;
}
export declare const DIFF_CAP = 12000;
export declare const TEST_PATH: RegExp;
export declare function isGitWorkspace(root: string): boolean;
/**
 * Unified diff for the Lead's review. Git path: `git diff HEAD` covers
 * tracked edits; untracked files arrive inline (bounded). Non-git workspaces
 * get no diff — changedFiles still reports the snapshot-level path set.
 */
export declare function collectDiff(root: string, _changed: readonly string[]): Promise<string | undefined>;
/** Quoted spans the instruction explicitly required (backtick / single / double), 6-120 chars. */
export declare function instructionLiterals(instruction: string): readonly string[];
/**
 * Static warnings — never gates, always advisory:
 * 1. mutating an existing test file (especially deleting its lines) is the
 *    classic worker cheat; surfaced for Lead judgement, not auto-denied.
 * 2. literals the instruction quoted but no changed file contains.
 */
export declare function staticAudit(root: string, base: WorkspaceSnapshot | undefined, changed: readonly string[], instruction: string): Promise<StaticAuditResult>;
/** Run the caller-supplied verify commands serially; each bounded to 120s. */
export declare function runVerification(root: string, commands: readonly string[]): Promise<readonly VerificationRecord[]>;
/** Diff + snapshot compare used by dispatch; shared so repair rounds reuse it. */
export declare function auditWorkspace(input: {
    root: string;
    base: WorkspaceSnapshot | undefined;
    candidate: WorkspaceSnapshot | undefined;
    instruction: string;
}): Promise<{
    changedFiles: readonly string[];
    unifiedDiff?: string;
    staticAudits: StaticAuditResult;
}>;
