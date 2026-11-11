import { AgentGenerationId, FusionRunId, type WorktreeRecord } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'

/** H02 worktree manager: acquisition, merge outcomes, rollback and cleanup.
 *
 * The ledger journals worktree lifecycle transitions; actual `git worktree` execution is a Host
 * runtime concern and stays unverified until a real Host adapter exists. mergeChanges() is the
 * deterministic domain model of a two-way merge used by tests and the future Host adapter. */

export type WorktreeSpec = {
  worktreeId: string; generationId: string; path: string; branch: string; baseCommit: string
}

export type MergeInput = Readonly<Record<string, string>>

export type MergeOutcome =
  | { status: 'CLEAN'; merged: Record<string, string> }
  | { status: 'CONFLICT'; conflicts: string[] }

/** Deterministic two-way merge over a shared base snapshot. Disjoint edits and byte-identical
 * edits merge clean; any path modified differently on both sides conflicts. */
export function mergeChanges(base: MergeInput, ours: MergeInput, theirs: MergeInput): MergeOutcome {
  const paths = new Set<string>([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])
  const merged: Record<string, string> = {}
  const conflicts: string[] = []
  for (const file of [...paths].sort()) {
    const baseValue = base[file]
    const oursValue = ours[file]
    const theirsValue = theirs[file]
    if (oursValue !== undefined && theirsValue !== undefined && oursValue !== theirsValue) conflicts.push(file)
    else if (oursValue !== undefined) merged[file] = oursValue
    else if (theirsValue !== undefined) merged[file] = theirsValue
    else if (baseValue !== undefined) merged[file] = baseValue
  }
  if (conflicts.length > 0) return { status: 'CONFLICT', conflicts }
  return { status: 'CLEAN', merged }
}

export class WorktreeManager {
  constructor(private readonly manager: RunManager, private readonly capabilityReport: HostCapabilityReport) {}

  acquire(runId: string, spec: WorktreeSpec): WorktreeRecord {
    this.gate()
    this.append(runId, { schemaVersion: 1, eventId: `fusion/worktree/${spec.worktreeId}/acquired`,
      type: 'WORKTREE_ACQUIRED', runId: FusionRunId(runId), worktreeId: spec.worktreeId,
      generationId: AgentGenerationId(spec.generationId), path: spec.path, branch: spec.branch,
      baseCommit: spec.baseCommit } as RunEventInput)
    return this.get(spec.worktreeId)
  }

  merge(runId: string, worktreeId: string, result: { mergeCommit: string; mergeDigest: string }): WorktreeRecord {
    this.gate()
    const revision = this.currentRevision(runId)
    this.append(runId, { schemaVersion: 1, eventId: `fusion/worktree/${worktreeId}/merged-r${revision}`,
      type: 'WORKTREE_MERGED', runId: FusionRunId(runId), worktreeId,
      mergeCommit: result.mergeCommit, mergeDigest: result.mergeDigest } as RunEventInput)
    return this.get(worktreeId)
  }

  rollback(runId: string, worktreeId: string, reason: string): WorktreeRecord {
    this.gate()
    const revision = this.currentRevision(runId)
    this.append(runId, { schemaVersion: 1, eventId: `fusion/worktree/${worktreeId}/rolled-back-r${revision}`,
      type: 'WORKTREE_ROLLED_BACK', runId: FusionRunId(runId), worktreeId, reason } as RunEventInput)
    return this.get(worktreeId)
  }

  release(runId: string, worktreeId: string): WorktreeRecord {
    this.gate()
    const revision = this.currentRevision(runId)
    this.append(runId, { schemaVersion: 1, eventId: `fusion/worktree/${worktreeId}/released-r${revision}`,
      type: 'WORKTREE_RELEASED', runId: FusionRunId(runId), worktreeId } as RunEventInput)
    return this.get(worktreeId)
  }

  get(worktreeId: string): WorktreeRecord {
    const record = this.manager.getState().worktrees[worktreeId]
    if (!record) throw new Error(`NEEDS_REPAIR: worktree ${worktreeId} unknown`)
    return record
  }

  private gate(): void {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
  }

  private currentRevision(runId: string): number {
    const current = this.manager.getRun(FusionRunId(runId))
    if (!current) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    return current.revision
  }

  private append(runId: string, input: RunEventInput): void {
    this.manager.append(input, this.currentRevision(runId))
  }
}
