import { AgentGenerationId, FusionRunId, type AssignmentRecord } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'
import type { AgentManager } from '../agents/index.js'
import type { IndependentVerifier } from '../verification/index.js'
import type { BudgetService } from '../budget/index.js'
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'

/** I02 shadow-review feedback, graded rework and Lead arbitration.
 *
 * Failure triage maps report severity to rework tiers: MINOR/MAJOR are ordered directly with
 * additive constraints (nothing is ever dropped from a brief), BLOCKER requires an explicit Lead
 * arbitration ruling first. Rework has a budget upper bound, and previously verified requirements
 * must never regress silently — assertNoRegression fails closed. */

export type ReworkTier = 'MINOR' | 'MAJOR' | 'BLOCKER'
export type ArbitrationRuling = 'REWORK' | 'ACCEPT' | 'ESCALATE'

export type TriageVerdict = { verdict: 'RISK'; severity?: 'LOW' | 'MEDIUM' | 'HIGH'; findings: string[] }
export type TriageOutcome =
  | { tier: ReworkTier; ordered: true; briefRevision: number }
  | { tier: ReworkTier; ordered: false; requiresArbitration: true }

export class ReworkCoordinator {
  constructor(private readonly manager: RunManager, private readonly agents: AgentManager,
    private readonly verifier: IndependentVerifier, private readonly budgets?: BudgetService,
    private readonly capabilityReport?: HostCapabilityReport) {}

  triage(runId: string, assignmentId: string, input: TriageVerdict): TriageOutcome {
    if (input.verdict !== 'RISK') throw new TypeError('triage requires a RISK verdict')
    const tier: ReworkTier = input.severity === 'HIGH' ? 'BLOCKER' : (input.severity === 'LOW' ? 'MINOR' : 'MAJOR')
    if (tier === 'BLOCKER') return { tier, ordered: false, requiresArbitration: true }
    const record = this.orderRework(runId, assignmentId, tier, input.findings)
    return { tier, ordered: true, briefRevision: record.briefRevision }
  }

  orderRework(runId: string, assignmentId: string, tier: ReworkTier, addedConstraints: string[],
    budget?: { budgetId: string; estimatedCostMicros: number }): AssignmentRecord {
    this.gate()
    if (budget && this.budgets) {
      const report = this.budgets.report(budget.budgetId)
      const remaining = report.hardCostMicros + report.approvedOverrunMicros - report.spentMicros
      if (budget.estimatedCostMicros > remaining) {
        throw new Error(`REWORK_BUDGET_EXCEEDED: estimated ${budget.estimatedCostMicros}µ exceeds remaining ${remaining}µ on budget ${budget.budgetId}`)
      }
    }
    const assignment = this.agents.get(assignmentId)
    if (!assignment) throw new Error(`REWORK_CONFLICT: assignment ${assignmentId} is unknown`)
    if (assignment.status !== 'OPEN') throw new Error(`REWORK_CONFLICT: rework requires an open assignment, ${assignmentId} is ${assignment.status}`)
    if (tier === 'BLOCKER' && assignment.arbitration?.ruling !== 'REWORK') {
      throw new Error(`REWORK_CONFLICT: blocker rework requires a lead REWORK ruling on ${assignmentId}`)
    }
    const nextRevision = assignment.briefRevision + 1
    this.append(runId, { schemaVersion: 1, eventId: `fusion/rework/${assignmentId}/r${nextRevision}`,
      type: 'REWORK_ORDERED', runId: FusionRunId(runId), assignmentId, tier,
      addedConstraints: addedConstraints.map((finding) => `rework:${tier} ${finding}`).sort() } as RunEventInput)
    const updated = this.agents.get(assignmentId)
    if (!updated) throw new Error('REWORK_CONFLICT: rework order vanished after append')
    return updated
  }

  arbitrate(runId: string, assignmentId: string, arbiterGenerationId: string, ruling: ArbitrationRuling, reason: string): AssignmentRecord {
    this.gate()
    this.append(runId, { schemaVersion: 1, eventId: `fusion/arbitration/${assignmentId}/${ruling.toLowerCase()}-r${this.currentRevision(runId)}`,
      type: 'ASSIGNMENT_ARBITRATED', runId: FusionRunId(runId), assignmentId,
      arbiterGenerationId: AgentGenerationId(arbiterGenerationId), ruling, reason } as RunEventInput)
    const updated = this.agents.get(assignmentId)
    if (!updated) throw new Error('REWORK_CONFLICT: arbitration vanished after append')
    return updated
  }

  /** Previously verified requirements must still be verified; a silent regression fails closed. */
  assertNoRegression(runId: string, requirementIds: readonly string[]): void {
    for (const requirementId of requirementIds) {
      const record = this.verifier.requirement(requirementId)
      if (record.runId !== FusionRunId(runId)) {
        throw new Error(`NEEDS_REPAIR: requirement ${requirementId} belongs to another run`)
      }
      if (record.verdict !== 'VERIFIED') {
        throw new Error(`REGRESSION_DETECTED: requirement ${requirementId} regressed to ${record.verdict}`)
      }
    }
  }

  private gate(): void {
    if (this.capabilityReport) requireHostOperation(this.capabilityReport, 'lifecycle.transition')
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
