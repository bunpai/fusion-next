import { type WorktreeRecord } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
import { type HostCapabilityReport } from '../host-capabilities/index.js';
/** H02 worktree manager: acquisition, merge outcomes, rollback and cleanup.
 *
 * The ledger journals worktree lifecycle transitions; actual `git worktree` execution is a Host
 * runtime concern and stays unverified until a real Host adapter exists. mergeChanges() is the
 * deterministic domain model of a two-way merge used by tests and the future Host adapter. */
export type WorktreeSpec = {
    worktreeId: string;
    generationId: string;
    path: string;
    branch: string;
    baseCommit: string;
};
export type MergeInput = Readonly<Record<string, string>>;
export type MergeOutcome = {
    status: 'CLEAN';
    merged: Record<string, string>;
} | {
    status: 'CONFLICT';
    conflicts: string[];
};
/** Deterministic two-way merge over a shared base snapshot. Disjoint edits and byte-identical
 * edits merge clean; any path modified differently on both sides conflicts. */
export declare function mergeChanges(base: MergeInput, ours: MergeInput, theirs: MergeInput): MergeOutcome;
export declare class WorktreeManager {
    private readonly manager;
    private readonly capabilityReport;
    constructor(manager: RunManager, capabilityReport: HostCapabilityReport);
    acquire(runId: string, spec: WorktreeSpec): WorktreeRecord;
    merge(runId: string, worktreeId: string, result: {
        mergeCommit: string;
        mergeDigest: string;
    }): WorktreeRecord;
    rollback(runId: string, worktreeId: string, reason: string): WorktreeRecord;
    release(runId: string, worktreeId: string): WorktreeRecord;
    get(worktreeId: string): WorktreeRecord;
    private gate;
    private currentRevision;
    private append;
}
