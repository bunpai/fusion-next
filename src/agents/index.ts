import { AgentGenerationId, FusionRunId, type AgentReportRecord, type AssignmentRecord, type AssignmentRole, type ReportStatus } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'
import type { FusionRunId as FusionRunIdBrand } from '../lifecycle/index.js'
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'

export type BriefSpec = { objective: string; constraints: string[]; contextRefs: string[] }
export type AssignSpec = {
  assignmentId: string; role: AssignmentRole; workerAgentId?: string
  brief: BriefSpec; writeScope: string[]
}
export type ReportSpec = {
  reportId: string; assignmentId: string; generationId: string
  summary: string; status: ReportStatus; artifacts: string[]
}

/** E01 agent manager.
 *
 * Owns the task-brief/assignment ledger: a Lead assigns work (DIRECT = executes itself without a
 * worker, DELEGATE = hands a brief to a worker agent), revises briefs monotonically (Lead→worker
 * direction), receives journaled reports (worker→Lead direction) that are FENCED against stale
 * generations (plan D02: a late report can never commit into a new generation), and records
 * Takeover (Q06) when a Lead takes control of a stalled assignment.
 *
 * All state lives in lifecycle events + the SQLite projection; nothing here mutates outside a
 * RunManager transaction. */
export class AgentManager {
  constructor(private readonly manager: RunManager, private readonly capabilityReport: HostCapabilityReport) {}

  assign(runId: string, spec: AssignSpec): AssignmentRecord {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    const runIdBrand = FusionRunId(runId)
    this.append(runIdBrand, { schemaVersion: 1, eventId: `fusion/assignment/${spec.assignmentId}/created`,
      type: 'ASSIGNMENT_CREATED', runId: runIdBrand, assignmentId: spec.assignmentId, role: spec.role,
      workerAgentId: spec.workerAgentId, brief: { ...spec.brief, revision: 1 },
      writeScope: [...spec.writeScope].sort() } as RunEventInput)
    const record = this.manager.getState().assignments[spec.assignmentId]
    if (!record) throw new Error('ASSIGNMENT_LEDGER_CONFLICT: assignment missing after append')
    return record
  }

  reviseBrief(runId: string, assignmentId: string, briefRevision: number, spec: BriefSpec): void {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/assignment/${assignmentId}/brief-r${briefRevision}`,
      type: 'ASSIGNMENT_BRIEF_REVISED', runId: FusionRunId(runId), assignmentId, briefRevision,
      objective: spec.objective, constraints: spec.constraints, contextRefs: spec.contextRefs } as RunEventInput)
  }

  report(runId: string, spec: ReportSpec): AgentReportRecord {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/report/${spec.reportId}`,
      type: 'ASSIGNMENT_REPORTED', runId: FusionRunId(runId), assignmentId: spec.assignmentId,
      reportId: spec.reportId, generationId: AgentGenerationId(spec.generationId),
      summary: spec.summary, status: spec.status, artifacts: spec.artifacts } as RunEventInput)
    const record = this.manager.getState().reports[spec.reportId]
    if (!record) throw new Error('ASSIGNMENT_LEDGER_CONFLICT: report missing after append')
    return record
  }

  complete(runId: string, assignmentId: string, reportId: string): void {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/assignment/${assignmentId}/completed`,
      type: 'ASSIGNMENT_COMPLETED', runId: FusionRunId(runId), assignmentId, reportId } as RunEventInput)
  }

  fail(runId: string, assignmentId: string, reportId: string): void {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/assignment/${assignmentId}/failed`,
      type: 'ASSIGNMENT_FAILED', runId: FusionRunId(runId), assignmentId, reportId } as RunEventInput)
  }

  takeover(runId: string, assignmentId: string, byAgentId: string, reason: string): void {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    this.append(FusionRunId(runId), { schemaVersion: 1, eventId: `fusion/assignment/${assignmentId}/takeover`,
      type: 'ASSIGNMENT_TAKEOVER', runId: FusionRunId(runId), assignmentId, byAgentId, reason } as RunEventInput)
  }

  get(assignmentId: string): AssignmentRecord | undefined {
    return this.manager.getState().assignments[assignmentId]
  }

  list(runId: string): AssignmentRecord[] {
    return Object.values(this.manager.getState().assignments).filter(record => record.runId === runId)
  }

  private append(runId: FusionRunIdBrand, input: RunEventInput): void {
    const current = this.manager.getRun(runId)
    if (!current) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    this.manager.append(input, current.revision)
  }
}
