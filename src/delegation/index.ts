import type { RunEventInput, RunManager } from '../run-manager/index.js'
import type { AgentManager } from '../agents/index.js'
import type { RoleManager } from '../agents/roles.js'
import { FusionRunId, type FusionRunId as FusionRunIdBrand, type DelegationStats } from '../lifecycle/index.js'

export type DelegationInput = {
  directCostMicros: number
  delegateWorkerCostMicros: number
  coordinationCostMicros: number
  reviewCostMicros: number
  /** Parallelism credit: an effective speedup of N divides the worker cost by N. */
  parallelSpeedup?: number
  budgetRemainingMicros?: number
  recentFailures?: number
  failureThreshold?: number
}
export type DelegationDecision = { mode: 'DIRECT' | 'DELEGATE'; netBenefitMicros: number; reasons: string[] }
export type DelegationFeedback = {
  verdict: 'CLEAN' | 'RISK'; severity?: 'LOW' | 'MEDIUM' | 'HIGH'; findings: string[]
}

/** G03 value-of-delegation with an adaptive-brief feedback loop.
 *
 * `advise` is pure and deterministic (plan: 相同输入确定性选择): delegation wins only when its
 * projected net value is strictly positive AND the budget can fund it AND recent delegation
 * failures have not tripped the fallback gate (委派负收益时 Direct). `applyFeedback` folds shadow
 * review findings back into the assignment brief additively — existing constraints are never
 * dropped (约束不丢失). Outcomes are journaled as per-mode statistics. */
export class DelegationAdvisor {
  constructor(private readonly manager: RunManager, private readonly agents: AgentManager, private readonly roles?: RoleManager) {}

  advise(input: DelegationInput): DelegationDecision {
    const reasons: string[] = []
    const speedup = input.parallelSpeedup === undefined ? 1 : Math.max(1, input.parallelSpeedup)
    const effectiveWorker = Math.ceil(input.delegateWorkerCostMicros / speedup)
    const delegateTotal = effectiveWorker + input.coordinationCostMicros + input.reviewCostMicros
    const net = input.directCostMicros - delegateTotal
    if (input.recentFailures !== undefined && input.failureThreshold !== undefined
      && input.recentFailures >= input.failureThreshold) {
      reasons.push(`recent delegation failures ${input.recentFailures} reached threshold ${input.failureThreshold}`)
    }
    if (input.budgetRemainingMicros !== undefined && delegateTotal > input.budgetRemainingMicros) {
      reasons.push(`delegation cost ${delegateTotal} exceeds remaining budget ${input.budgetRemainingMicros}`)
    }
    if (net <= 0) reasons.push(`delegation net value ${net} is not positive`)
    const blocked = reasons.length > 0
    return { mode: blocked ? 'DIRECT' : 'DELEGATE', netBenefitMicros: net, reasons }
  }

  recordOutcome(runId: string, assignmentId: string, mode: 'DIRECT' | 'DELEGATE',
    costMicros: number, verdict: 'COMPLETED' | 'FAILED'): void {
    // One journal id per recorded outcome: the per-mode attempt index keeps retries of the same
    // logical outcome idempotent while distinct outcomes get distinct ids.
    const attemptIndex = this.manager.getState().delegation[mode].attempts + 1
    this.append(FusionRunId(runId), { schemaVersion: 1,
      eventId: `fusion/delegation/${assignmentId}/outcome-${mode.toLowerCase()}-a${attemptIndex}`,
      type: 'DELEGATION_OUTCOME_RECORDED', runId: FusionRunId(runId), assignmentId, mode,
      costMicros, verdict } as RunEventInput)
  }

  stats(): { DIRECT: DelegationStats; DELEGATE: DelegationStats } {
    const delegation = this.manager.getState().delegation
    return { DIRECT: delegation.DIRECT, DELEGATE: delegation.DELEGATE }
  }

  applyFeedback(runId: string, assignmentId: string, feedback: DelegationFeedback): { briefRevision: number; escalated: boolean } {
    if (feedback.verdict !== 'RISK') return { briefRevision: this.currentBriefRevision(assignmentId), escalated: false }
    const extra = feedback.findings.map(finding => `risk:${feedback.severity ?? 'MEDIUM'} ${finding}`)
    const updated = this.roles
      ? this.roles.adaptBrief(runId, assignmentId, { objective: this.currentObjective(assignmentId), extraConstraints: extra })
      : this.adaptBriefFallback(runId, assignmentId, extra)
    return { briefRevision: updated.briefRevision, escalated: true }
  }

  private currentBriefRevision(assignmentId: string): number {
    const record = this.agents.get(assignmentId)
    if (!record) throw new Error(`NEEDS_REPAIR: assignment ${assignmentId} unknown`)
    return record.briefRevision
  }

  private currentObjective(assignmentId: string): string {
    const record = this.agents.get(assignmentId)
    if (!record) throw new Error(`NEEDS_REPAIR: assignment ${assignmentId} unknown`)
    return record.objective
  }

  /** Without a RoleManager, fold the constraint directly through the journal (still additive). */
  private adaptBriefFallback(runId: string, assignmentId: string, extraConstraints: string[]) {
    const record = this.agents.get(assignmentId)
    if (!record) throw new Error(`NEEDS_REPAIR: assignment ${assignmentId} unknown`)
    const merged = [...new Set([...record.constraints, ...extraConstraints])].sort()
    this.agents.reviseBrief(runId, assignmentId, record.briefRevision + 1,
      { objective: record.objective, constraints: merged, contextRefs: [...record.contextRefs] })
    const updated = this.agents.get(assignmentId)
    if (!updated) throw new Error('ASSIGNMENT_LEDGER_CONFLICT: assignment missing after revise')
    return updated
  }

  private append(runId: FusionRunIdBrand, input: RunEventInput): void {
    const current = this.manager.getRun(runId)
    if (!current) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    this.manager.append(input, current.revision)
  }
}
