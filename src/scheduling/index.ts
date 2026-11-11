import { FusionRunId, type AssignmentRecord } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'
import type { AgentManager } from '../agents/index.js'

/** H01 scheduling: assignment DAG, file ownership and provider limits.
 *
 * Dependencies and file claims are journaled through the reducer, so crash/restart restores them
 * exactly (plan H03 prerequisite). The provider limiter is deliberately in-memory runtime state:
 * provider concurrency windows are ephemeral scheduling facts, not durable domain state. */
export class Scheduler {
  constructor(private readonly manager: RunManager, private readonly agents: AgentManager) {}

  declareDependency(runId: string, assignmentId: string, dependsOnId: string): void {
    this.append(FusionRunId(runId), { schemaVersion: 1,
      eventId: `fusion/assignment/${assignmentId}/depends/${dependsOnId}`,
      type: 'ASSIGNMENT_DEPENDENCY_DECLARED', runId: FusionRunId(runId), assignmentId,
      dependsOnId } as RunEventInput)
  }

  claimFiles(runId: string, assignmentId: string, paths: string[]): void {
    this.append(FusionRunId(runId), { schemaVersion: 1,
      eventId: `fusion/assignment/${assignmentId}/files-r${this.currentRevision(runId, assignmentId)}`,
      type: 'ASSIGNMENT_FILES_CLAIMED', runId: FusionRunId(runId), assignmentId,
      paths: [...paths].sort() } as RunEventInput)
  }

  /** Deterministic readiness: OPEN assignments whose dependencies are all COMPLETED, ordered by id. */
  readyAssignments(runId: string): string[] {
    const state = this.manager.getState()
    return Object.values(state.assignments)
      .filter(record => record.runId === runId && record.status === 'OPEN'
        && record.dependsOn.every(dep => state.assignments[dep]?.status === 'COMPLETED'))
      .map(record => record.assignmentId)
      .sort()
  }

  ownerOf(runId: string, filePath: string): string | undefined {
    for (const record of Object.values(this.manager.getState().assignments)) {
      if (record.runId !== runId) continue
      if (record.status !== 'OPEN' && record.status !== 'TAKEN_OVER') continue
      if (record.claimedPaths.includes(filePath)) return record.assignmentId
    }
    return undefined
  }

  dependenciesOf(assignmentId: string): readonly string[] {
    const record = this.manager.getState().assignments[assignmentId]
    if (!record) throw new Error(`NEEDS_REPAIR: assignment ${assignmentId} unknown`)
    return record.dependsOn
  }

  private currentRevision(runId: string, assignmentId: string): number {
    const record: AssignmentRecord | undefined = this.manager.getState().assignments[assignmentId]
    if (!record) throw new Error(`NEEDS_REPAIR: assignment ${assignmentId} unknown`)
    return record.claimedPaths.length
  }

  private append(runId: FusionRunId, input: RunEventInput): void {
    const current = this.manager.getRun(runId)
    if (!current) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    this.manager.append(input, current.revision)
  }
}

export type ProviderLimiterOptions = { maxConcurrentPerProvider: number; maxConcurrentTotal: number }

/** Ephemeral provider rate limiting. acquire() is a pure capacity check; release() frees the slot. */
export class ProviderLimiter {
  private readonly perProvider = new Map<string, number>()
  private total = 0

  constructor(private readonly options: ProviderLimiterOptions) {}

  acquire(provider: string): boolean {
    const current = this.perProvider.get(provider) ?? 0
    if (current >= this.options.maxConcurrentPerProvider) return false
    if (this.total >= this.options.maxConcurrentTotal) return false
    this.perProvider.set(provider, current + 1)
    this.total += 1
    return true
  }

  release(provider: string): void {
    const current = this.perProvider.get(provider) ?? 0
    if (current <= 0) throw new Error(`PROVIDER_LIMITER_INVALID: no in-flight call for provider ${provider}`)
    this.perProvider.set(provider, current - 1)
    this.total -= 1
  }

  inFlight(): Record<string, number> & { total: number } {
    const view = Object.assign(Object.create(null), { total: this.total }) as Record<string, number> & { total: number }
    for (const [provider, count] of this.perProvider) view[provider] = count
    return view
  }
}
