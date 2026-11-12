import { createHash } from 'node:crypto'

import type { WorkOrder, WorkerReport, TaskId, SessionId } from '../contracts.js'
import { AgentGenerationId, FusionRunId } from '../lifecycle/index.js'
import type { ModelRoute } from '../lifecycle/index.js'
import type { RunManager } from '../run-manager/index.js'
import type { SqliteFusionStore } from '../task/sqlite-store.js'
import type { ResolvedProfile } from '../profile/resolve.js'

/** Legacy task events that have a truthful v2 journal equivalent. */
interface WorkOrderPreparedPayload { order: WorkOrder; reservedChild: SessionId }
interface ScopeExpandedPayload { workOrderId: string; added: readonly string[]; reason: string }
interface AcceptanceAmendedPayload { workOrderId: string; reason: string }
interface ReportSubmittedPayload { operationId: string; report: WorkerReport }
interface ReviewCompletedPayload { decision: 'accept' | 'rework' | 'needs-decision' | 'REVIEW_INCOMPLETE' }
interface ChildAcceptedPayload { operationId: string; child: SessionId }
interface OutcomeUnknownPayload { operationId: string; reason: string }

const digestOfRoute = (route: { provider: string; model: string; reasoningEffort?: string }): string =>
  createHash('sha256').update(JSON.stringify([route.provider, route.model, route.reasoningEffort ?? ''])).digest('hex').slice(0, 16)

const asModelRoute = (route: { provider: string; model: string; reasoningEffort?: string }): ModelRoute => ({
  provider: route.provider, model: route.model,
  ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
  capabilityDigest: digestOfRoute(route),
})

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values.filter(v => typeof v === 'string' && v.length > 0))].sort()

/**
 * Mirrors legacy coordinator task events into the v2 lifecycle journal as a
 * SHADOW projection. The live control plane stays legacy; this journal gives
 * the B02+ reducer/projection machinery real runtime data without switching
 * the control path. Every append is fail-safe: a shadow failure never breaks
 * the live task, and re-emitted events collapse through deterministic ids.
 */
export class V2Shadow {
  private readonly briefs = new Map<string, { objective: string; constraints: string[]; revision: number }>()
  private readonly assignmentsByWorkOrder = new Map<string, string>()
  private readonly workerGenerationByAssignment = new Map<string, string>()
  private readonly effectsByOperation = new Map<string, string>()
  private readonly leadGenerations = new Set<string>()
  private readonly warned = new Set<string>()

  constructor(
    private readonly manager: RunManager,
    private readonly store: SqliteFusionStore,
    private readonly profile: () => ResolvedProfile | undefined,
  ) {}

  handle(taskId: TaskId, type: string, payload: unknown): void {
    try {
      this.project(taskId, type, payload)
    } catch (error) {
      // Shadow writes must never break the live task. Warn once per event type.
      if (!this.warned.has(type)) {
        this.warned.add(type)
        console.warn(`[dsh-model-fusion] v2 shadow projection failed for ${type}: ${String(error)}`)
      }
    }
  }

  private project(taskId: TaskId, type: string, payload: unknown): void {
    switch (type) {
      case 'work-order/prepared': return this.workOrderPrepared(taskId, payload as WorkOrderPreparedPayload)
      case 'work-order/scope-expanded': return this.scopeExpanded(taskId, payload as ScopeExpandedPayload)
      case 'work-order/acceptance-amended': return this.acceptanceAmended(taskId, payload as AcceptanceAmendedPayload)
      case 'report/submitted': return this.reportSubmitted(taskId, payload as ReportSubmittedPayload)
      case 'review/completed': return this.reviewCompleted(taskId, payload as ReviewCompletedPayload)
      case 'child/claimed': return this.effectDispatched(taskId, payload as { operationId: string })
      case 'effect/outcome-unknown': return this.effectUnresolved(taskId, payload as OutcomeUnknownPayload)
      case 'task/completed': return this.taskCompleted(taskId)
      default: return
    }
  }

  /** task/created carries parent:SessionId; the v2 run id follows fusionActivate's convention. */
  private runIdFor(taskId: TaskId): FusionRunId | undefined {
    const parent = this.store.load(taskId)?.parent
    if (typeof parent !== 'string' || parent.length === 0) return undefined
    const runId = FusionRunId(`fusion-run-${parent}`)
    return this.manager.getState().runs[runId] ? runId : undefined
  }

  private leadAgentFor(taskId: TaskId): string | undefined {
    const parent = this.store.load(taskId)?.parent
    return typeof parent === 'string' && parent.length > 0 ? parent : undefined
  }

  private append(runId: FusionRunId, eventId: string, type: string, payload: Record<string, unknown>): void {
    const revision = this.manager.getRun(runId)!.revision
    this.manager.append({ schemaVersion: 1, eventId, type, runId, ...payload } as never, revision)
  }

  /** Emit PREPARED+ACTIVATED for an agent once; later calls collapse through state checks. */
  private ensureGeneration(runId: FusionRunId, agentId: string, route: { provider: string; model: string; reasoningEffort?: string }, generationId: string): string | undefined {
    const state = this.manager.getState()
    if (state.generations[generationId]) {
      const current = state.runs[runId]?.currentGenerationIds[agentId]
      if (state.generations[generationId]!.status !== 'ACTIVE') return undefined
      return current === generationId ? generationId : undefined
    }
    const run = state.runs[runId]
    if (!run || run.status !== 'RUNNING') return undefined
    const epoch = Object.values(state.generations).filter(g => g.agentId === agentId)
      .reduce((max, g) => Math.max(max, g.epoch), 0) + 1
    const genId = AgentGenerationId(generationId)
    this.append(runId, `fusion/v2-shadow/${runId}/${generationId}-prepared`, 'GENERATION_PREPARED', {
      agentId, generationId: genId, epoch, sessionId: `shadow-${agentId}`, route: asModelRoute(route),
    })
    this.append(runId, `fusion/v2-shadow/${runId}/${generationId}-activated`, 'GENERATION_ACTIVATED', {
      agentId, generationId: genId,
    })
    return generationId
  }

  private workOrderPrepared(taskId: TaskId, { order, reservedChild }: WorkOrderPreparedPayload): void {
    const runId = this.runIdFor(taskId), lead = this.leadAgentFor(taskId)
    const resolved = this.profile()
    if (!runId || !lead || !resolved) return
    const leadGen = `gen-lead-${runId}`
    if (this.ensureGeneration(runId, lead, resolved.profile.lead, leadGen)) this.leadGenerations.add(leadGen)
    const workerAgent = String(reservedChild)
    const workerGen = `gen-worker-${runId}-${order.id}`
    const workerGenerationId = this.ensureGeneration(runId, workerAgent, resolved.profile.worker, workerGen)
    if (!workerGenerationId) return
    const assignmentId = `wo-${order.id}`
    this.assignmentsByWorkOrder.set(order.id, assignmentId)
    this.workerGenerationByAssignment.set(assignmentId, workerGenerationId)
    this.briefs.set(assignmentId, {
      objective: order.goal,
      constraints: order.constraints.map(c => c.text),
      revision: order.revision,
    })
    this.append(runId, `fusion/v2-shadow/${runId}/${assignmentId}`, 'ASSIGNMENT_CREATED', {
      assignmentId, role: 'WORKER', workerAgentId: workerAgent,
      brief: { objective: order.goal, constraints: sortedUnique(order.constraints.map(c => c.text)), contextRefs: [], revision: order.revision },
      writeScope: sortedUnique(order.allowedPaths),
    })
    // S19: claim the work-order write scope so a fork sibling's overlapping
    // claim is rejected by the reducer and the deny gate can see the owner.
    const paths = sortedUnique(order.allowedPaths)
    if (paths.length > 0) {
      this.append(runId, `fusion/v2-shadow/${runId}/${assignmentId}-files`, 'ASSIGNMENT_FILES_CLAIMED', {
        assignmentId, paths,
      })
    }
    // Work orders are external effects: an in-flight worker is an unsettled
    // effect the recovery plan must surface. IDEMPOTENT modes (explore/text)
    // may be re-dispatched; implement mode needs verification on outcome loss.
    const effectId = `fx-${order.operationId}`
    this.effectsByOperation.set(order.operationId, effectId)
    const effectClass = order.mode === 'implement' ? 'NEEDS_VERIFICATION' : 'IDEMPOTENT'
    this.append(runId, `fusion/v2-shadow/${runId}/${effectId}-intent`, 'EFFECT_INTENT_RECORDED', {
      effectId, generationId: AgentGenerationId(workerGenerationId), toolCallId: String(order.operationId),
      effectClass,
      fingerprint: createHash('sha256')
        .update(JSON.stringify({ tool: 'native-worker', args: order.operationId, target: order.id })).digest('hex'),
      idempotencyKey: `wo:${order.operationId}`,
    })
  }

  private effectDispatched(taskId: TaskId, { operationId }: { operationId: string }): void {
    const runId = this.runIdFor(taskId), effectId = runId && this.effectsByOperation.get(operationId)
    if (!runId || !effectId) return
    this.append(runId, `fusion/v2-shadow/${runId}/${effectId}-dispatched`, 'EFFECT_DISPATCHED', { effectId })
  }

  private effectSettled(taskId: TaskId, { operationId, report }: ReportSubmittedPayload): void {
    const runId = this.runIdFor(taskId), effectId = runId && this.effectsByOperation.get(operationId)
    if (!runId || !effectId) return
    this.append(runId, `fusion/v2-shadow/${runId}/${effectId}-receipt`, 'EFFECT_RECEIPT_RECORDED', {
      effectId, receiptRef: `wr-${operationId}`,
      outcome: report.status === 'completed' ? 'SUCCEEDED' : 'FAILED_KNOWN',
    })
  }

  private effectUnresolved(taskId: TaskId, { operationId }: OutcomeUnknownPayload): void {
    const runId = this.runIdFor(taskId), effectId = runId && this.effectsByOperation.get(operationId)
    if (!runId || !effectId) return
    this.append(runId, `fusion/v2-shadow/${runId}/${effectId}-unresolved`, 'EFFECT_UNRESOLVED', { effectId })
  }

  private reviseBrief(taskId: TaskId, workOrderId: string, addConstraints: readonly string[]): void {
    const runId = this.runIdFor(taskId)
    const assignmentId = this.assignmentsByWorkOrder.get(workOrderId)
    const brief = runId && this.briefs.get(assignmentId ?? '')
    if (!runId || !assignmentId || !brief) return
    const revision = brief.revision + 1
    const constraints = sortedUnique([...brief.constraints, ...addConstraints])
    this.briefs.set(assignmentId, { objective: brief.objective, constraints, revision })
    this.append(runId, `fusion/v2-shadow/${runId}/${assignmentId}-brief-r${revision}`, 'ASSIGNMENT_BRIEF_REVISED', {
      assignmentId, briefRevision: revision,
      objective: brief.objective, constraints, contextRefs: [],
    })
  }

  private scopeExpanded(taskId: TaskId, payload: ScopeExpandedPayload): void {
    this.reviseBrief(taskId, payload.workOrderId, [`scope-expanded: ${payload.added.join(', ')}`])
  }

  private acceptanceAmended(taskId: TaskId, payload: AcceptanceAmendedPayload): void {
    this.reviseBrief(taskId, payload.workOrderId, [`acceptance-amended: ${payload.reason}`])
  }

  private reportSubmitted(taskId: TaskId, { operationId, report }: ReportSubmittedPayload): void {
    const runId = this.runIdFor(taskId)
    const assignmentId = runId && this.assignmentsByWorkOrder.get(String(report.workOrderId))
    const generationId = assignmentId && this.workerGenerationByAssignment.get(assignmentId)
    if (!runId || !assignmentId || !generationId) return
    const status = report.status === 'completed' ? 'COMPLETED' : report.status === 'needs-decision' ? 'NEEDS_INPUT' : 'FAILED'
    this.append(runId, `fusion/v2-shadow/${runId}/report-${operationId}`, 'ASSIGNMENT_REPORTED', {
      reportId: `wr-${operationId}`, assignmentId, generationId: AgentGenerationId(generationId),
      summary: report.summary, status,
      artifacts: [String(report.changeManifest?.id ?? '')].filter(id => id.length > 0),
    })
    this.effectSettled(taskId, { operationId, report })
  }

  private reviewCompleted(taskId: TaskId, { decision }: ReviewCompletedPayload): void {
    const runId = this.runIdFor(taskId), lead = this.leadAgentFor(taskId)
    if (!runId || !lead) return
    const assignmentId = [...this.assignmentsByWorkOrder.values()].at(-1)
    const leadGen = assignmentId && `gen-lead-${runId}`
    if (!assignmentId || !leadGen) return
    const state = this.manager.getState()
    if (state.generations[leadGen]?.status !== 'ACTIVE' || state.runs[runId]?.currentGenerationIds[lead] !== leadGen) return
    const ruling = decision === 'accept' ? 'ACCEPT' : decision === 'rework' ? 'REWORK' : 'ESCALATE'
    const count = Object.values(state.reports).filter(r => r.assignmentId === assignmentId).length
    this.append(runId, `fusion/v2-shadow/${runId}/arbitration-${assignmentId}-${ruling.toLowerCase()}-${count}`, 'ASSIGNMENT_ARBITRATED', {
      assignmentId, ruling, arbiterGenerationId: AgentGenerationId(leadGen), reason: `lead review decision: ${decision}`,
    })
  }

  private taskCompleted(taskId: TaskId): void {
    const runId = this.runIdFor(taskId)
    if (!runId) return
    const state = this.manager.getState()
    const open = Object.values(state.assignments).filter(a => a.runId === runId && a.status === 'OPEN')
    for (const assignment of open) {
      const report = assignment.lastReportId ? state.reports[assignment.lastReportId] : undefined
      if (report?.status !== 'COMPLETED') continue
      this.append(runId, `fusion/v2-shadow/${runId}/${assignment.assignmentId}-completed`, 'ASSIGNMENT_COMPLETED', {
        assignmentId: assignment.assignmentId, reportId: report.reportId,
      })
    }
  }
}
