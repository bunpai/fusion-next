import type {
  ControlState,
  Digest,
  ExecutionIntent,
  ExplorationReport,
  FusionEvent,
  LogicalApproval,
  OutboxRow,
  Phase,
  ReviewGate,
  ReviewReadinessReceipt,
  ReviewResultV2,
  ReviewTicket,
  RunSelection,
  SessionId,
  SnapshotId,
  TaskId,
  VerificationLevel,
  WorkOrder,
  WorkerReport,
  WriteLease,
} from '../contracts.js'

export interface AcceptedReview {
  readonly ticket: ReviewTicket
  readonly resultDigest: Digest
}

export interface TaskState {
  readonly schemaVersion: 1
  readonly taskId: TaskId
  readonly revision: number
  readonly seq: number
  readonly phase: Phase
  readonly parent: SessionId
  readonly selection: RunSelection
  readonly profileDigest?: Digest
  readonly intent?: ExecutionIntent
  readonly reservedChild?: SessionId
  readonly acceptedChild?: SessionId
  readonly acceptedMessageId?: string
  readonly currentWorkOrder?: WorkOrder
  readonly exploration?: ExplorationReport
  /** Bounded parallelism: one read-only explore order may run alongside the
   * current (implement/text) order. Read-only means no write-lease, no
   * effect and no allowedPaths conflict with the primary order. */
  readonly parallelOrder?: WorkOrder
  readonly parallelChild?: SessionId
  readonly parallelAccepted?: boolean
  readonly parallelExploration?: ExplorationReport
  readonly candidateReport?: WorkerReport
  readonly validatedReport?: WorkerReport
  readonly validatedReceipt?: ReviewReadinessReceipt
  readonly activeReviewTicket?: ReviewTicket
  readonly reviewResult?: ReviewResultV2
  readonly reviewResultDigest?: Digest
  readonly acceptedReview?: AcceptedReview
  readonly reviewGeneration: number
  readonly ignoredReviewResults: readonly ReviewResultV2[]
  readonly staleValidations: readonly { readonly reportDigest: Digest; readonly reason: string }[]
  /** Candidate if unvalidated, otherwise the validated report. Compatibility projection. */
  readonly lastReport?: WorkerReport
  readonly reviewGate?: ReviewGate
  readonly verification: VerificationLevel
  readonly pendingApprovalIds: readonly string[]
  readonly pendingApprovals: Readonly<Record<string, LogicalApproval>>
  readonly control: ControlState
  readonly outcomeUnknown: boolean
  readonly resumePhase?: Phase
  readonly lease?: WriteLease
  readonly lastSnapshot?: SnapshotId
  readonly appliedEventIds: readonly string[]
}

export interface PersistedTask {
  readonly state: TaskState
  readonly events: readonly FusionEvent[]
  readonly outbox: readonly OutboxRow[]
}
