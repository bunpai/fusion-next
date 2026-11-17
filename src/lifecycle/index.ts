/** B01 domain-only event projection. No Host event subscriptions, storage, effects, or IO. */
import type { Brand } from '../contracts.js'

export type FusionRunId = Brand<string, 'FusionRunId'>
export type AgentGenerationId = Brand<string, 'AgentGenerationId'>
export type SessionAliasId = Brand<string, 'SessionAliasId'>
const id = <B extends string>(value: string): Brand<string, B> => {
  if (!value.trim() || value.includes('\0')) throw new TypeError('invalid lifecycle id')
  return value as Brand<string, B>
}
export const FusionRunId = (value: string): FusionRunId => id<'FusionRunId'>(value)
export const AgentGenerationId = (value: string): AgentGenerationId => id<'AgentGenerationId'>(value)
export const SessionAliasId = (value: string): SessionAliasId => id<'SessionAliasId'>(value)

export type RunMode = 'DIRECT' | 'DELEGATE' | 'PARALLEL' | 'TAKEOVER'
export type RunStatus = 'ACTIVATING' | 'RUNNING' | 'SUSPENDING' | 'SUSPENDED' | 'VERIFYING' |
  'WAITING_APPROVAL' | 'WAITING_PROVIDER' | 'NEEDS_REPAIR' | 'COMPLETED_SUCCESS' |
  'COMPLETED_FAILURE' | 'CANCELLED' | 'BUDGET_STOPPED'
export interface ModelRoute { provider: string; model: string; reasoningEffort?: string; capabilityDigest: string }
export interface FusionRun {
  id: FusionRunId
  hostSessionId: SessionAliasId
  branchId?: string
  taskId: string
  mode: RunMode
  status: RunStatus
  revision: number
  budgetId: string
  agentIds: readonly string[]
  /** Compatibility projection for a single current generation; do not use for parallel ownership. */
  currentGenerationId?: AgentGenerationId
  currentGenerationIds: Readonly<Record<string, AgentGenerationId>>
  createdSeq: number
  pendingApprovalIds: readonly string[]
  activeLeaseIds: readonly string[]
  restorePending?: boolean
  hasActivated: boolean
}
export interface AgentGeneration {
  id: AgentGenerationId
  runId: FusionRunId
  agentId: string
  sessionId: string
  route: ModelRoute
  epoch: number
  status: 'PREPARING' | 'ACTIVE' | 'DRAINING' | 'RETIRED'
}
export interface SessionAlias {
  hostSessionId: SessionAliasId
  runId: FusionRunId
  branchId?: string
  forkPointSeq?: number
  selectionStatus: 'INACTIVE' | 'ACTIVE' | 'SUSPENDING'
  revision: number
}
export interface BranchLineage {
  branchId: string
  parentBranchId?: string
  parentRunId: FusionRunId
  forkPointSeq: number
}

/** Normalized internal session signals for a future adapter (not Host SDK hooks). */
export type SessionLifecycleSignal = { readonly schemaVersion: 1; readonly eventId: string } & (
  | { type: 'SESSION_CREATED' | 'SESSION_OPENED' | 'SESSION_DETACHED' | 'SESSION_RESTORED' | 'SESSION_CLOSED'; hostSessionId: SessionAliasId }
  | { type: 'SESSION_FORKED'; sourceSessionId: SessionAliasId; targetSessionId: SessionAliasId; forkPointSeq: number }
  | { type: 'MODEL_SELECTION_CHANGED'; hostSessionId: SessionAliasId; selection: 'FUSION' | 'ORDINARY' }
)

type Created = { type: 'RUN_CREATED'; runId: FusionRunId; hostSessionId: SessionAliasId; taskId: string; budgetId: string; branchId?: string; mode: RunMode }
type Forked = { type: 'SESSION_FORKED'; runId: FusionRunId; hostSessionId: SessionAliasId; sourceRunId: FusionRunId; sourceHostSessionId: SessionAliasId; branchId: string; forkPointSeq: number; taskId: string; budgetId: string; agentId: string; mode: RunMode }
type Bound = { type: 'RUN_ACTIVATED' | 'RUN_RESTORE_REQUESTED' | 'RUN_RESTORED'; runId: FusionRunId; hostSessionId: SessionAliasId }
type RunChange = { type: 'RUN_SUSPEND_REQUESTED' | 'RUN_SUSPENDED'; runId: FusionRunId }
type Prepared = { type: 'GENERATION_PREPARED'; runId: FusionRunId; generationId: AgentGenerationId; agentId: string; sessionId: string; route: ModelRoute; epoch: number }
type SwitchCommitted = { type: 'GENERATION_SWITCH_COMMITTED'; runId: FusionRunId; fromGenerationId: AgentGenerationId; toGenerationId: AgentGenerationId }
type GenerationChange = { type: 'GENERATION_ACTIVATED' | 'GENERATION_DRAINING' | 'GENERATION_RETIRED' | 'GENERATION_CALLBACK' | 'GENERATION_PREPARATION_ABORTED' | 'GENERATION_DRAIN_CANCELLED'; runId: FusionRunId; generationId: AgentGenerationId }

/** D01 effect idempotency classes: safe auto-retry, verify-before-retry, never auto-retry. */
export type EffectClass = 'IDEMPOTENT' | 'NEEDS_VERIFICATION' | 'NEVER_RETRY'
export type EffectState = 'INTENT' | 'EXECUTING' | 'SETTLED' | 'NEEDS_REPAIR' | 'DISCARDED'
export interface EffectRecord {
  readonly effectId: string
  readonly runId: FusionRunId
  readonly generationId: AgentGenerationId
  readonly toolCallId: string
  readonly effectClass: EffectClass
  readonly fingerprint: string
  readonly idempotencyKey: string
  readonly state: EffectState
  readonly receiptRef?: string
  readonly outcome?: 'SUCCEEDED' | 'FAILED_KNOWN'
  readonly resolvedBy?: 'receipt' | 'reconcile'
}
export type TransitionMode = 'MANUAL' | 'AUTO_UPGRADE' | 'AUTO_DOWNGRADE' | 'CROSS_PROVIDER'
export type TransitionPhaseState = 'CHECKPOINTED' | 'COMMITTED' | 'ROLLED_BACK'
export interface TransitionTargetSpec {
  agentId: string; sessionId: string
  route: { provider: string; model: string; capabilityDigest: string }
  requirements: { requireTools?: string[]; minContextTokens?: number; capabilityDigest?: string }
}
export interface TransitionRecord {
  transitionId: string; runId: FusionRunId; agentId: string; mode: TransitionMode
  fromGenerationId: AgentGenerationId; toGenerationId: AgentGenerationId
  phase: TransitionPhaseState; expectedRevision: number; error?: string
  /** H03: the target spec journaled at checkpoint time so a restart can resume without re-asking. */
  toSpec?: TransitionTargetSpec
}
export interface GenerationAuthority {
  generationId: AgentGenerationId; runId: FusionRunId
  toolScope: readonly string[]; writePaths: readonly string[]; approvalRequired: readonly string[]
}
export type AssignmentRole = 'LEAD' | 'WORKER' | 'REVIEWER'
export type AssignmentStatus = 'OPEN' | 'COMPLETED' | 'FAILED' | 'TAKEN_OVER'
export type ReportStatus = 'COMPLETED' | 'FAILED' | 'NEEDS_INPUT'
export interface AssignmentRecord {
  assignmentId: string; runId: FusionRunId; role: AssignmentRole; workerAgentId?: string
  briefRevision: number; objective: string; constraints: readonly string[]; contextRefs: readonly string[]
  writeScope: readonly string[]; status: AssignmentStatus; lastReportId?: string
  takenBy?: string; takenReason?: string
  /** H01: DAG dependencies (sorted, acyclic) and currently-held file claims (released on finalize). */
  dependsOn: readonly string[]; claimedPaths: readonly string[]
  /** I02: latest Lead arbitration ruling (last one wins, journaled per event). */
  arbitration?: { ruling: 'REWORK' | 'ACCEPT' | 'ESCALATE'; by: AgentGenerationId; reason: string }
}
export interface AgentReportRecord {
  reportId: string; runId: FusionRunId; assignmentId: string; generationId: AgentGenerationId
  summary: string; status: ReportStatus; artifacts: readonly string[]
}
export interface ContextCheckpointRef {
  checkpointId: string; runId: FusionRunId; generationId: AgentGenerationId; epoch: number
  digest: string; totalTokens: number; layerTokens: { L0: number; L1: number; L2: number; L3: number }
}
export interface WorktreeRecord {
  worktreeId: string; runId: FusionRunId; generationId: AgentGenerationId
  path: string; branch: string; baseCommit: string
  state: 'ACTIVE' | 'MERGED' | 'ROLLED_BACK' | 'RELEASED'
  mergeCommit?: string; mergeDigest?: string; rollbackRef?: string
}
export type EvidenceLevel = 'E0' | 'E1' | 'E2' | 'E3'
export type VerificationVerdict = 'NOT_VERIFIED' | 'VERIFIED' | 'FAILED_VERIFICATION'
export interface EvidenceRecord {
  evidenceId: string; runId: FusionRunId; requirementId: string; level: EvidenceLevel
  source: string; command?: string; exitCode?: number; artifactDigest?: string
  producerGenerationId: AgentGenerationId
}
export interface RequirementRecord {
  requirementId: string; runId: FusionRunId
  evidenceIds: readonly string[]; verdict: VerificationVerdict; verifiedBy?: AgentGenerationId
}
type EffectIntent = {
  type: 'EFFECT_INTENT_RECORDED'; runId: FusionRunId; effectId: string
  generationId: AgentGenerationId; toolCallId: string; effectClass: EffectClass
  fingerprint: string; idempotencyKey: string
}
type EffectTransition = {
  type: 'EFFECT_DISPATCHED' | 'EFFECT_RECEIPT_RECORDED' | 'EFFECT_UNRESOLVED' | 'EFFECT_RECONCILED' | 'EFFECT_DISCARDED'
  runId: FusionRunId; effectId: string
  receiptRef?: string; outcome?: 'SUCCEEDED' | 'FAILED_KNOWN'
}
/** Internal projected domain events, NOT discovered or promised Host SDK events. */
type ContextCheckpointed = {
  type: 'CONTEXT_CHECKPOINTED'; runId: FusionRunId; checkpointId: string
  generationId: AgentGenerationId; epoch: number; digest: string; totalTokens: number
  layerTokens: { L0: number; L1: number; L2: number; L3: number }
}
export interface BudgetRecord {
  budgetId: string; hardCostMicros: number; maxCalls?: number; maxRetries?: number
  spentMicros: number; reservedMicros: number; approvedOverrunMicros: number; approvalId?: string
  openReservations: Readonly<Record<string, number>>
  usage: Readonly<Record<string, BudgetUsageEntry>>
}
export interface BudgetUsageEntry {
  runId: FusionRunId
  providerRequestId: string; attempt: number; route: ModelRoute; priceVersion?: string
  inputTokens: number; outputTokens: number; cacheReadTokens: number
  costMicros: number; status: 'COMPLETED' | 'FAILED' | 'CANCELLED'
}
export interface CacheEntryRecord {
  runId: FusionRunId; generationId: AgentGenerationId; cacheKey: string
  savedCostMicros: number; keepaliveCostMicros: number; expireAt: number
  policyVersion: string; keepaliveActive: boolean
}
export interface DelegationStats { attempts: number; failures: number; spentMicros: number }
type DelegationOutcomeRecorded = {
  type: 'DELEGATION_OUTCOME_RECORDED'; runId: FusionRunId; assignmentId: string
  mode: 'DIRECT' | 'DELEGATE'; costMicros: number; verdict: 'COMPLETED' | 'FAILED'
}
type CacheEntryRecorded = {
  type: 'CACHE_ENTRY_RECORDED'; runId: FusionRunId; generationId: AgentGenerationId; cacheKey: string
  savedCostMicros: number; keepaliveCostMicros: number; expireAt: number; policyVersion: string
}
type CacheKeepaliveTick = {
  type: 'CACHE_KEEPALIVE_TICK'; runId: FusionRunId; generationId: AgentGenerationId; cacheKey: string
  tickCostMicros: number; savingsRatio: number; cachedTokens: number
}
type CacheKeepaliveStopped = {
  type: 'CACHE_KEEPALIVE_STOPPED'; runId: FusionRunId; generationId: AgentGenerationId; cacheKey: string; reason: string
}
type BudgetReserved = {
  type: 'BUDGET_RESERVED'; runId: FusionRunId; budgetId: string; hardCostMicros: number
  maxCalls?: number; maxRetries?: number
}
type BudgetCallReserved = {
  type: 'BUDGET_CALL_RESERVED'; runId: FusionRunId; budgetId: string; reservationId: string; reserveMicros: number
}
type BudgetReservationSettled = {
  type: 'BUDGET_RESERVATION_SETTLED'; runId: FusionRunId; budgetId: string; reservationId: string
  providerRequestId: string; attempt: number; route: ModelRoute; priceVersion?: string
  inputTokens: number; outputTokens: number; cacheReadTokens: number
  costMicros: number; priced: boolean; status: 'COMPLETED' | 'FAILED' | 'CANCELLED'
}
type BudgetOverrunApproved = {
  type: 'BUDGET_OVERRUN_APPROVED'; runId: FusionRunId; budgetId: string; extraMicros: number
  approvalId: string; approver: string
}
type AssignmentCreated = {
  type: 'ASSIGNMENT_CREATED'; runId: FusionRunId; assignmentId: string; role: AssignmentRole
  workerAgentId?: string; brief: { objective: string; constraints: string[]; contextRefs: string[]; revision: number }
  writeScope: string[]
}
type AssignmentBriefRevised = {
  type: 'ASSIGNMENT_BRIEF_REVISED'; runId: FusionRunId; assignmentId: string; briefRevision: number
  objective: string; constraints: string[]; contextRefs: string[]
}
type AssignmentReported = {
  type: 'ASSIGNMENT_REPORTED'; runId: FusionRunId; assignmentId: string; reportId: string
  generationId: AgentGenerationId; summary: string; status: ReportStatus; artifacts: string[]
}
type AssignmentCompleted = { type: 'ASSIGNMENT_COMPLETED'; runId: FusionRunId; assignmentId: string; reportId: string }
type AssignmentFailed = { type: 'ASSIGNMENT_FAILED'; runId: FusionRunId; assignmentId: string; reportId: string }
type AssignmentTakeover = { type: 'ASSIGNMENT_TAKEOVER'; runId: FusionRunId; assignmentId: string; byAgentId: string; reason: string }
type AssignmentDependencyDeclared = { type: 'ASSIGNMENT_DEPENDENCY_DECLARED'; runId: FusionRunId; assignmentId: string; dependsOnId: string }
type AssignmentFilesClaimed = { type: 'ASSIGNMENT_FILES_CLAIMED'; runId: FusionRunId; assignmentId: string; paths: string[] }
type WorktreeAcquired = {
  type: 'WORKTREE_ACQUIRED'; runId: FusionRunId; worktreeId: string; generationId: AgentGenerationId
  path: string; branch: string; baseCommit: string
}
type WorktreeMerged = { type: 'WORKTREE_MERGED'; runId: FusionRunId; worktreeId: string; mergeCommit: string; mergeDigest: string }
type WorktreeRolledBack = { type: 'WORKTREE_ROLLED_BACK'; runId: FusionRunId; worktreeId: string; reason: string }
type WorktreeReleased = { type: 'WORKTREE_RELEASED'; runId: FusionRunId; worktreeId: string }
type WorktreeEvents = WorktreeAcquired | WorktreeMerged | WorktreeRolledBack | WorktreeReleased
type AssignmentArbitrated = {
  type: 'ASSIGNMENT_ARBITRATED'; runId: FusionRunId; assignmentId: string
  arbiterGenerationId: AgentGenerationId; ruling: 'REWORK' | 'ACCEPT' | 'ESCALATE'; reason: string
}
type ReworkOrdered = {
  type: 'REWORK_ORDERED'; runId: FusionRunId; assignmentId: string
  tier: 'MINOR' | 'MAJOR' | 'BLOCKER'; addedConstraints: string[]
}
type EvidenceRecorded = {
  type: 'EVIDENCE_RECORDED'; runId: FusionRunId; evidenceId: string; requirementId: string
  level: EvidenceLevel; source: string; command?: string; exitCode?: number; artifactDigest?: string
  producerGenerationId: AgentGenerationId
}
type VerificationRecorded = {
  type: 'VERIFICATION_RECORDED'; runId: FusionRunId; requirementId: string; evidenceId: string
  verifierGenerationId: AgentGenerationId; verdict: Exclude<VerificationVerdict, 'NOT_VERIFIED'> | 'NOT_VERIFIED'
}
type AuthorityIssued = {
  type: 'AUTHORITY_ISSUED'; runId: FusionRunId; generationId: AgentGenerationId
  toolScope: string[]; writePaths: string[]; approvalRequired: string[]
}
type TransitionCheckpointed = {
  type: 'TRANSITION_CHECKPOINTED'; runId: FusionRunId; transitionId: string; agentId: string
  mode: TransitionMode; fromGenerationId: AgentGenerationId; toGenerationId: AgentGenerationId
  toSpec?: TransitionTargetSpec
}
type TransitionCommitted = { type: 'TRANSITION_COMMITTED'; runId: FusionRunId; transitionId: string }
type TransitionRolledBack = { type: 'TRANSITION_ROLLED_BACK'; runId: FusionRunId; transitionId: string; error?: string }
type TransitionEvents = TransitionCheckpointed | TransitionCommitted | TransitionRolledBack

export type LifecycleEvent = { readonly schemaVersion: 1; readonly eventId: string; readonly seq: number; readonly expectedRevision: number } &
  (Created | Forked | Bound | RunChange | Prepared | GenerationChange | SwitchCommitted | EffectIntent | EffectTransition | TransitionEvents | AuthorityIssued | AssignmentCreated | AssignmentBriefRevised | AssignmentReported | AssignmentCompleted | AssignmentFailed | AssignmentTakeover | AssignmentDependencyDeclared | AssignmentFilesClaimed | WorktreeEvents | EvidenceRecorded | VerificationRecorded | AssignmentArbitrated | ReworkOrdered | ContextCheckpointed | BudgetReserved | BudgetCallReserved | BudgetReservationSettled | BudgetOverrunApproved | CacheEntryRecorded | CacheKeepaliveTick | CacheKeepaliveStopped | DelegationOutcomeRecorded)
export interface LifecycleState {
  readonly revision: number
  readonly seq: number
  readonly runs: Readonly<Record<string, FusionRun>>
  readonly aliases: Readonly<Record<string, SessionAlias>>
  readonly generations: Readonly<Record<string, AgentGeneration>>
  readonly lineage: Readonly<Record<string, BranchLineage>>
  readonly effects: Readonly<Record<string, EffectRecord>>
  readonly transitions: Readonly<Record<string, TransitionRecord>>
  readonly authorities: Readonly<Record<string, GenerationAuthority>>
  readonly assignments: Readonly<Record<string, AssignmentRecord>>
  readonly reports: Readonly<Record<string, AgentReportRecord>>
  readonly worktrees: Readonly<Record<string, WorktreeRecord>>
  readonly evidence: Readonly<Record<string, EvidenceRecord>>
  readonly requirements: Readonly<Record<string, RequirementRecord>>
  readonly budgets: Readonly<Record<string, BudgetRecord>>
  readonly caches: Readonly<Record<string, CacheEntryRecord>>
  readonly delegation: Readonly<Record<'DIRECT' | 'DELEGATE', DelegationStats>>
  readonly checkpoints: Readonly<Record<string, ContextCheckpointRef>>
  /** Event id -> canonical payload; replay duplicate with differing payload is a conflict. */
  readonly appliedEvents: Readonly<Record<string, string>>
}
const dictionary = <T>(source?: Readonly<Record<string, T>>): Record<string, T> => Object.assign(Object.create(null) as Record<string, T>, source)
/**
 * Copy-on-write dictionary: reads fall through to `source`, the first write clones.
 * Values are always replaced (never mutated in place) inside reduceLifecycle, so
 * untouched dictionaries can be shared with the previous state at O(1) cost.
 */
interface LazyDict<V> { readonly proxy: Record<string, V>; materialize(): Record<string, V> }
const lazyDict = <V>(source: Readonly<Record<string, V>>): LazyDict<V> => {
  let copy: Record<string, V> | undefined
  const ensure = (): Record<string, V> => (copy ??= dictionary(source))
  const view = (): Readonly<Record<string, V>> => copy ?? source
  // Proxy target is an empty object: the frozen source's non-configurable properties
  // would make descriptor traps lie, so all lookups delegate to the view instead.
  const proxy = new Proxy({} as Record<string, V>, {
    get(_target, key) { return view()[key as string] },
    set(_target, key, value) { ensure()[key as string] = value; return true },
    deleteProperty(_target, key) { delete ensure()[key as string]; return true },
    has(_target, key) { return key in view() },
    ownKeys() { return Reflect.ownKeys(view()) },
    getOwnPropertyDescriptor(_target, key) {
      const current = view()
      if (!(key in current)) return undefined
      return { enumerable: true, configurable: true, writable: true, value: current[key as string] }
    },
  })
  return { proxy, materialize: () => copy ?? source as Record<string, V> }
}
function deepFreeze<T>(value: T, except?: object): T {
  if (value && typeof value === 'object' && value !== except && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested, except)
  }
  return value
}
/**
 * appliedEvents is an append-only idempotency ledger read only inside this reducer.
 * Across one reduce chain it stays a single shared mutable dictionary (marked in this
 * set): each event appends one key in O(1) instead of copying the whole record.
 * The dictionary is attached unfrozen to every produced state, so older states see
 * later entries — acceptable because the field is a write-once ledger, not a value
 * consumers diff between states.
 */
const MUTABLE_APPLIED = new WeakSet<Record<string, string>>()
const stable = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item)
export const emptyLifecycleState = (): LifecycleState => deepFreeze({ revision: 0, seq: 0, runs: dictionary(), aliases: dictionary(), generations: dictionary(), lineage: dictionary(), effects: dictionary(), transitions: dictionary(), authorities: dictionary(), assignments: dictionary(), reports: dictionary(), worktrees: dictionary(), evidence: dictionary(), requirements: dictionary(), checkpoints: dictionary(), budgets: dictionary(), caches: dictionary(), delegation: { DIRECT: { attempts: 0, failures: 0, spentMicros: 0 }, DELEGATE: { attempts: 0, failures: 0, spentMicros: 0 } }, appliedEvents: dictionary() })
const invalid = (reason: string): never => { throw new Error(`lifecycle conflict: ${reason}`) }
function assert(condition: unknown, reason: string): asserts condition { if (!condition) invalid(reason) }
function requireCache(caches: Record<string, CacheEntryRecord>, key: string): CacheEntryRecord {
  const record = caches[key]
  if (!record) invalid(`cache entry ${key} unknown`)
  return record
}
function requireBudget(budgets: Record<string, BudgetRecord>, budgetId: string): BudgetRecord {
  const record = budgets[budgetId]
  if (!record) invalid(`budget ${budgetId} unknown`)
  return record
}
function requireAssignment(assignments: Record<string, AssignmentRecord>, assignmentId: string): AssignmentRecord {
  const record = assignments[assignmentId]
  if (!record) invalid(`assignment ${assignmentId} unknown`)
  return record
}
function requireWorktree(worktrees: Record<string, WorktreeRecord>, worktreeId: string): WorktreeRecord {
  const record = worktrees[worktreeId]
  if (!record) invalid(`worktree ${worktreeId} unknown`)
  return record
}
function isSortedUnique(values: readonly string[]): boolean {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value.length === 0 || value.includes('\u0000')) return false
    if (i > 0 && values[i - 1] >= value) return false
  }
  return true
}

export function reduceLifecycle(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  assert(event.schemaVersion === 1, 'unsupported event schema version')
  assert(Boolean(event.eventId?.trim()), 'empty event id')
  const fingerprint = stable(event)
  const previous = state.appliedEvents[event.eventId]
  if (previous !== undefined) {
    assert(previous === fingerprint, 'event id reused with different contents')
    return state
  }
  assert(event.seq === state.seq + 1, `out-of-order seq: expected ${state.seq + 1}`)
  assert(event.expectedRevision === state.revision, `stale revision: expected ${state.revision}`)
  // Copy-on-write dictionaries: untouched fields keep sharing the previous state's
  // frozen records, so a single-event reduction costs O(touched dictionaries).
  const lazy = {
    runs: lazyDict(state.runs), aliases: lazyDict(state.aliases), generations: lazyDict(state.generations),
    lineage: lazyDict(state.lineage), effects: lazyDict(state.effects), transitions: lazyDict(state.transitions),
    authorities: lazyDict(state.authorities), assignments: lazyDict(state.assignments), reports: lazyDict(state.reports),
    worktrees: lazyDict(state.worktrees), evidence: lazyDict(state.evidence), requirements: lazyDict(state.requirements),
    checkpoints: lazyDict(state.checkpoints), budgets: lazyDict(state.budgets), caches: lazyDict(state.caches),
  }
  const runs = lazy.runs.proxy, aliases = lazy.aliases.proxy, generations = lazy.generations.proxy,
    lineage = lazy.lineage.proxy, effects = lazy.effects.proxy, transitions = lazy.transitions.proxy,
    authorities = lazy.authorities.proxy, assignments = lazy.assignments.proxy, reports = lazy.reports.proxy,
    worktrees = lazy.worktrees.proxy, evidence = lazy.evidence.proxy, requirements = lazy.requirements.proxy,
    checkpoints = lazy.checkpoints.proxy, budgets = lazy.budgets.proxy, caches = lazy.caches.proxy,
    delegation = { DIRECT: { ...state.delegation.DIRECT }, DELEGATE: { ...state.delegation.DELEGATE } }
  // appliedEvents is the shared append-only ledger for this reduce chain (O(1) per event).
  const appliedEvents = MUTABLE_APPLIED.has(state.appliedEvents as Record<string, string>)
    ? state.appliedEvents as Record<string, string>
    : (() => { const shared = dictionary(state.appliedEvents); MUTABLE_APPLIED.add(shared); return shared })()
  const current = runs[event.runId]
  const requireRun = (): FusionRun => current ?? invalid('unknown run')
  const requireEffect = (effectId: string): EffectRecord => effects[effectId] ?? invalid('unknown effect')
  const changeRun = (patch: Partial<FusionRun>): void => { runs[event.runId] = { ...requireRun(), ...patch, revision: requireRun().revision + 1 } }
  const requireAlias = (sessionId: SessionAliasId): SessionAlias => {
    const alias = aliases[sessionId]
    assert(alias?.runId === event.runId, 'session alias ownership mismatch')
    return alias
  }
  const changeAlias = (sessionId: SessionAliasId, selectionStatus: SessionAlias['selectionStatus']): void => {
    const alias = requireAlias(sessionId)
    aliases[sessionId] = { ...alias, selectionStatus, revision: alias.revision + 1 }
  }
  const activeOwner = (sessionId: SessionAliasId): boolean => Object.values(runs).some(r => r.hostSessionId === sessionId && r.id !== event.runId && r.status === 'RUNNING')
  const makeRun = (data: Created | Forked, status: RunStatus, agentIds: readonly string[] = []): void => {
    assert(!current && !aliases[data.hostSessionId], 'run or session alias already exists')
    assert(Boolean(data.taskId && data.budgetId), 'task and budget identities required')
    assert(!data.branchId || !Object.values(runs).some(r => r.branchId === data.branchId), 'branch identity must be unique')
    assert(!Object.values(runs).some(r => r.taskId === data.taskId || r.budgetId === data.budgetId), 'task/budget identity must be unique')
    runs[data.runId] = { id: data.runId, hostSessionId: data.hostSessionId, branchId: data.branchId, taskId: data.taskId,
      mode: data.mode, status, revision: 1, budgetId: data.budgetId, agentIds: [...agentIds], currentGenerationIds: dictionary(), createdSeq: event.seq,
      pendingApprovalIds: [], activeLeaseIds: [], hasActivated: false }
    aliases[data.hostSessionId] = { hostSessionId: data.hostSessionId, runId: data.runId, branchId: data.branchId,
      ...(data.type === 'SESSION_FORKED' ? { forkPointSeq: data.forkPointSeq } : {}), selectionStatus: 'INACTIVE', revision: 1 }
  }
  switch (event.type) {
    case 'RUN_CREATED': makeRun(event, 'ACTIVATING'); break
    case 'SESSION_FORKED': {
      const source = runs[event.sourceRunId]
      assert(source?.hostSessionId === event.sourceHostSessionId, 'fork source ownership mismatch')
      assert(event.branchId && !lineage[event.branchId] && event.branchId !== source.branchId, 'fork branch identity conflict')
      assert(Number.isSafeInteger(event.forkPointSeq) && event.forkPointSeq >= source.createdSeq && event.forkPointSeq <= state.seq, 'invalid fork point')
      assert(event.agentId && !Object.values(runs).some(r => r.agentIds.includes(event.agentId)), 'fork agent identity conflict')
      makeRun(event, 'SUSPENDED', [event.agentId])
      lineage[event.branchId] = { branchId: event.branchId, parentRunId: source.id, parentBranchId: source.branchId, forkPointSeq: event.forkPointSeq }
      break
    }
    case 'RUN_ACTIVATED':
      assert(['ACTIVATING', 'SUSPENDED'].includes(requireRun().status) && !requireRun().hasActivated, 'illegal activation')
      assert(!activeOwner(event.hostSessionId), 'session already has active Fusion run')
      requireAlias(event.hostSessionId)
      changeRun({ status: 'RUNNING', hasActivated: true }); changeAlias(event.hostSessionId, 'ACTIVE'); break
    case 'RUN_SUSPEND_REQUESTED':
      assert(requireRun().status === 'RUNNING', 'illegal suspend request')
      changeRun({ status: 'SUSPENDING' }); changeAlias(requireRun().hostSessionId, 'SUSPENDING'); break
    case 'RUN_SUSPENDED':
      assert(requireRun().status === 'SUSPENDING', 'illegal suspend completion')
      changeRun({ status: 'SUSPENDED' }); changeAlias(requireRun().hostSessionId, 'INACTIVE'); break
    case 'RUN_RESTORE_REQUESTED':
      assert(requireRun().status === 'SUSPENDED', 'illegal restore request')
      requireAlias(event.hostSessionId)
      changeRun({ status: 'ACTIVATING', restorePending: true }); break
    case 'RUN_RESTORED':
      assert(requireRun().status === 'ACTIVATING' && requireRun().restorePending === true, 'illegal restore completion')
      assert(!activeOwner(event.hostSessionId), 'session already has active Fusion run')
      requireAlias(event.hostSessionId)
      changeRun({ status: 'RUNNING', restorePending: false, hasActivated: true }); changeAlias(event.hostSessionId, 'ACTIVE'); break
    case 'GENERATION_PREPARED': {
      const owner = requireRun()
      assert(!generations[event.generationId], 'generation id already exists')
      assert(event.agentId && event.sessionId && event.route.provider && event.route.model && event.route.capabilityDigest, 'incomplete generation')
      assert(!Object.values(runs).some(r => r.id !== event.runId && r.agentIds.includes(event.agentId)),
        'agent identity already owned by another run')
      const predecessors = Object.values(generations).filter(g => g.runId === event.runId && g.agentId === event.agentId)
      // Prepare may overlap an old draining generation; activation still requires current generation retirement.
      assert(predecessors.every(g => g.status === 'RETIRED' || g.status === 'DRAINING'), 'agent has non-draining generation')
      assert(event.epoch === Math.max(0, ...predecessors.map(g => g.epoch)) + 1, 'stale generation epoch')
      assert(owner.status === 'RUNNING', 'run is not active')
      generations[event.generationId] = { id: event.generationId, runId: event.runId, agentId: event.agentId, sessionId: event.sessionId, route: { ...event.route }, epoch: event.epoch, status: 'PREPARING' }
      changeRun({ agentIds: owner.agentIds.includes(event.agentId) ? owner.agentIds : [...owner.agentIds, event.agentId] })
      break
    }
    case 'GENERATION_SWITCH_COMMITTED': {
      const oldGeneration = generations[event.fromGenerationId]
      const nextGeneration = generations[event.toGenerationId]
      assert(oldGeneration?.runId === event.runId && nextGeneration?.runId === event.runId &&
        oldGeneration.agentId === nextGeneration.agentId && oldGeneration.id !== nextGeneration.id,
      'atomic switch ownership mismatch')
      assert(oldGeneration.status === 'DRAINING' && nextGeneration.status === 'PREPARING', 'illegal atomic switch phases')
      assert(requireRun().status === 'RUNNING' && requireRun().currentGenerationIds[oldGeneration.agentId] === oldGeneration.id,
        'atomic switch requires current draining generation')
      generations[oldGeneration.id] = { ...oldGeneration, status: 'RETIRED' }
      generations[nextGeneration.id] = { ...nextGeneration, status: 'ACTIVE' }
      changeRun({ currentGenerationId: nextGeneration.id,
        currentGenerationIds: dictionary({ ...requireRun().currentGenerationIds, [oldGeneration.agentId]: nextGeneration.id }) })
      break
    }
    case 'GENERATION_ACTIVATED':
    case 'GENERATION_DRAINING':
    case 'GENERATION_RETIRED':
    case 'GENERATION_PREPARATION_ABORTED':
    case 'GENERATION_DRAIN_CANCELLED':
    case 'GENERATION_CALLBACK': {
      const gen = generations[event.generationId]
      assert(gen?.runId === event.runId, 'generation ownership mismatch')
      if (event.type === 'GENERATION_CALLBACK') {
        assert(gen.status === 'ACTIVE' && requireRun().status === 'RUNNING' && requireRun().currentGenerationIds[gen.agentId] === gen.id, 'stale generation callback fenced')
        changeRun({}); break
      }
      if (event.type === 'GENERATION_PREPARATION_ABORTED') {
        assert(gen.status === 'PREPARING' && requireRun().currentGenerationIds[gen.agentId] !== gen.id, 'cannot abort committed preparation')
        // If another generation is still draining, it remains current and can be resumed separately.
        generations[gen.id] = { ...gen, status: 'RETIRED' }
        changeRun({})
        break
      }
      if (event.type === 'GENERATION_DRAIN_CANCELLED') {
        assert(gen.status === 'DRAINING' && requireRun().currentGenerationIds[gen.agentId] === gen.id,
          'cannot resume a non-current or committed-away generation')
        assert(!Object.values(generations).some(g => g.runId === gen.runId && g.agentId === gen.agentId && g.id !== gen.id && g.status === 'PREPARING'),
          'cannot resume while replacement is preparing')
        generations[gen.id] = { ...gen, status: 'ACTIVE' }
        changeRun({})
        break
      }
      const expected = event.type === 'GENERATION_ACTIVATED' ? 'PREPARING' : event.type === 'GENERATION_DRAINING' ? 'ACTIVE' : 'DRAINING'
      assert(gen.status === expected, `illegal generation transition from ${gen.status}`)
      if (event.type === 'GENERATION_ACTIVATED') {
        assert(requireRun().status === 'RUNNING' && !requireRun().currentGenerationIds[gen.agentId], 'current generation already owned')
        changeRun({ currentGenerationId: gen.id, currentGenerationIds: dictionary({ ...requireRun().currentGenerationIds, [gen.agentId]: gen.id }) })
      } else if (event.type === 'GENERATION_RETIRED') {
        assert(!Object.values(generations).some(other => other.runId === gen.runId && other.agentId === gen.agentId &&
          other.id !== gen.id && other.status === 'PREPARING'), 'atomic switch required while replacement is preparing')
        assert(requireRun().currentGenerationIds[gen.agentId] === gen.id, 'retiring non-current generation')
        const next = dictionary(requireRun().currentGenerationIds)
        delete next[gen.agentId]
        changeRun({ currentGenerationId: requireRun().currentGenerationId === gen.id ? undefined : requireRun().currentGenerationId,
          currentGenerationIds: next })
      } else changeRun({})
      generations[gen.id] = { ...gen, status: event.type === 'GENERATION_ACTIVATED' ? 'ACTIVE' : event.type === 'GENERATION_DRAINING' ? 'DRAINING' : 'RETIRED' }
      break
    }
    case 'EFFECT_INTENT_RECORDED': {
      // An effect belongs to one run and one agent generation; the generation must already exist.
      // changeRun({}) keeps the per-run CAS revision advancing with every appended event.
      changeRun({})
      assert(!effects[event.effectId], 'effect id already exists')
      assert(!Object.values(effects).some(e => e.idempotencyKey === event.idempotencyKey), 'effect idempotency key already exists')
      assert(Boolean(event.toolCallId && event.fingerprint && event.idempotencyKey), 'incomplete effect intent')
      assert(event.effectClass === 'IDEMPOTENT' || event.effectClass === 'NEEDS_VERIFICATION' || event.effectClass === 'NEVER_RETRY', 'unknown effect class')
      assert(generations[event.generationId]?.runId === event.runId, 'effect generation ownership mismatch')
      effects[event.effectId] = { effectId: event.effectId, runId: event.runId, generationId: event.generationId,
        toolCallId: event.toolCallId, effectClass: event.effectClass, fingerprint: event.fingerprint,
        idempotencyKey: event.idempotencyKey, state: 'INTENT' }
      break
    }
    case 'EFFECT_DISPATCHED': {
      const effect = requireEffect(event.effectId)
      // Re-dispatching a running effect is only safe for the IDEMPOTENT class.
      assert(effect.state === 'INTENT' || (effect.state === 'EXECUTING' && effect.effectClass === 'IDEMPOTENT'), 'illegal effect dispatch')
      effects[event.effectId] = { ...effect, state: 'EXECUTING' }
      changeRun({})
      break
    }
    case 'EFFECT_RECEIPT_RECORDED': {
      const effect = requireEffect(event.effectId)
      assert(effect.state === 'EXECUTING', 'illegal effect receipt')
      assert(Boolean(event.receiptRef) && (event.outcome === 'SUCCEEDED' || event.outcome === 'FAILED_KNOWN'), 'incomplete effect receipt')
      effects[event.effectId] = { ...effect, state: 'SETTLED', receiptRef: event.receiptRef, outcome: event.outcome, resolvedBy: 'receipt' }
      changeRun({})
      break
    }
    case 'EFFECT_UNRESOLVED': {
      // Unknown external outcome: the effect can never be silently retried from here.
      const effect = requireEffect(event.effectId)
      assert(effect.state === 'EXECUTING', 'unknown outcome requires a dispatched effect')
      effects[event.effectId] = { ...effect, state: 'NEEDS_REPAIR' }
      changeRun({})
      break
    }
    case 'EFFECT_RECONCILED': {
      // Human/adapter-verified resolution of a NEEDS_REPAIR effect records evidence before settling.
      const effect = requireEffect(event.effectId)
      assert(effect.state === 'NEEDS_REPAIR', 'only unresolved effects can be reconciled')
      assert((event.outcome === 'SUCCEEDED' || event.outcome === 'FAILED_KNOWN') && Boolean(event.receiptRef), 'incomplete effect reconciliation')
      effects[event.effectId] = { ...effect, state: 'SETTLED', receiptRef: event.receiptRef, outcome: event.outcome, resolvedBy: 'reconcile' }
      changeRun({})
      break
    }
    case 'EFFECT_DISCARDED': {
      // Only an intent that was never dispatched can be discarded without external verification.
      const effect = requireEffect(event.effectId)
      assert(effect.state === 'INTENT', 'only undispatched intents can be discarded')
      effects[event.effectId] = { ...effect, state: 'DISCARDED' }
      changeRun({})
      break
    }
    case 'TRANSITION_CHECKPOINTED': {
      // The transition marker is journaled BEFORE any generation mutation: it is the durable
      // intent record every later step resumes from.
      assert(event.transitionId.length > 0 && !event.transitionId.includes('\u0000'), 'invalid transition id')
      assert(!transitions[event.transitionId], 'transition id already exists')
      const target = requireRun()
      assert(target.agentIds.includes(event.agentId), 'transition agent not in run')
      assert(generations[event.fromGenerationId]?.runId === event.runId, 'transition source generation mismatch')
      assert(event.toGenerationId !== event.fromGenerationId, 'transition target equals source')
      assert(event.mode === 'MANUAL' || event.mode === 'AUTO_UPGRADE' || event.mode === 'AUTO_DOWNGRADE' || event.mode === 'CROSS_PROVIDER', 'unknown transition mode')
      if (event.toSpec) {
        assert(event.toSpec.agentId === event.agentId, 'transition target spec agent mismatch')
        assert(event.toSpec.sessionId.length > 0, 'transition target spec session required')
        assert(event.toSpec.route.provider.length > 0 && event.toSpec.route.model.length > 0, 'transition target spec route required')
      }
      transitions[event.transitionId] = { transitionId: event.transitionId, runId: event.runId, agentId: event.agentId,
        mode: event.mode, fromGenerationId: event.fromGenerationId, toGenerationId: event.toGenerationId,
        phase: 'CHECKPOINTED', expectedRevision: event.expectedRevision, toSpec: event.toSpec }
      changeRun({})
      break
    }
    case 'TRANSITION_COMMITTED': {
      const record = transitions[event.transitionId]
      assert(record && record.runId === event.runId, 'unknown transition')
      assert(record.phase === 'CHECKPOINTED', 'transition already finalized')
      const replacement = generations[record.toGenerationId]
      const target = runs[record.runId]
      assert(replacement !== undefined && replacement.status === 'ACTIVE' && replacement.agentId === record.agentId, 'transition commit without active replacement generation')
      assert(target !== undefined && target.currentGenerationIds[record.agentId] === record.toGenerationId, 'transition commit without current replacement')
      transitions[event.transitionId] = { ...record, phase: 'COMMITTED' }
      changeRun({})
      break
    }
    case 'TRANSITION_ROLLED_BACK': {
      const record = transitions[event.transitionId]
      assert(record && record.runId === event.runId, 'unknown transition')
      assert(record.phase !== 'COMMITTED', 'committed transition cannot roll back')
      transitions[event.transitionId] = { ...record, phase: 'ROLLED_BACK', error: event.error }
      changeRun({})
      break
    }
    case 'ASSIGNMENT_CREATED': {
      assert(runs[event.runId] !== undefined, 'assignment run unknown')
      assert(!assignments[event.assignmentId], 'assignment id already exists')
      assert(event.role === 'LEAD' || event.role === 'WORKER' || event.role === 'REVIEWER', 'unknown assignment role')
      assert(!(event.role === 'LEAD' && event.workerAgentId), 'direct assignment must not carry a worker')
      assert(!event.workerAgentId || runs[event.runId].agentIds.includes(event.workerAgentId), 'assignment worker not in run')
      assert(event.brief.objective.length > 0, 'assignment brief objective required')
      assert(Number.isSafeInteger(event.brief.revision) && event.brief.revision >= 1, 'assignment brief revision must be a positive integer')
      assert(isSortedUnique(event.writeScope), 'invalid assignment write scope')
      assignments[event.assignmentId] = { assignmentId: event.assignmentId, runId: event.runId, role: event.role,
        workerAgentId: event.workerAgentId, briefRevision: event.brief.revision, objective: event.brief.objective,
        constraints: event.brief.constraints, contextRefs: event.brief.contextRefs, writeScope: event.writeScope,
        status: 'OPEN', dependsOn: [], claimedPaths: [] }
      changeRun({})
      break
    }
    case 'ASSIGNMENT_BRIEF_REVISED': {
      const record = requireAssignment(assignments, event.assignmentId)
      assert(record.runId === event.runId, 'assignment run mismatch')
      assert(Number.isSafeInteger(event.briefRevision) && event.briefRevision > record.briefRevision, 'assignment brief revision must increase')
      assert(event.objective.length > 0, 'assignment brief objective required')
      assignments[event.assignmentId] = { ...record, briefRevision: event.briefRevision,
        objective: event.objective, constraints: event.constraints, contextRefs: event.contextRefs }
      changeRun({})
      break
    }
    case 'ASSIGNMENT_REPORTED': {
      assert(!reports[event.reportId], 'report id already exists')
      const record = requireAssignment(assignments, event.assignmentId)
      assert(record.runId === event.runId, 'assignment run mismatch')
      const generation = generations[event.generationId]
      assert(generation !== undefined && generation.runId === event.runId, 'assignment report generation mismatch')
      assert(record.status !== 'TAKEN_OVER', 'assignment already taken over')
      assert(event.status === 'COMPLETED' || event.status === 'FAILED' || event.status === 'NEEDS_INPUT', 'unknown report status')
      assert(isSortedUnique(event.artifacts), 'invalid report artifacts')
      if (record.workerAgentId) {
        // A late report from a generation that is no longer current can never commit (plan D02/T14).
        assert(generation.agentId === record.workerAgentId &&
          runs[event.runId].currentGenerationIds[record.workerAgentId] === event.generationId, 'stale agent report fenced')
      }
      reports[event.reportId] = { reportId: event.reportId, runId: event.runId, assignmentId: event.assignmentId,
        generationId: event.generationId, summary: event.summary, status: event.status, artifacts: event.artifacts }
      assignments[event.assignmentId] = { ...record, lastReportId: event.reportId }
      changeRun({})
      break
    }
    case 'ASSIGNMENT_COMPLETED':
    case 'ASSIGNMENT_FAILED': {
      const record = requireAssignment(assignments, event.assignmentId)
      assert(record.runId === event.runId, 'assignment run mismatch')
      assert(record.status !== 'COMPLETED' && record.status !== 'FAILED', 'assignment already finalized')
      const report = reports[event.reportId]
      assert(report !== undefined && report.runId === event.runId && report.assignmentId === event.assignmentId, 'assignment report unknown')
      const wanted = event.type === 'ASSIGNMENT_COMPLETED' ? 'COMPLETED' : 'FAILED'
      assert(report.status === wanted, 'assignment completion requires a matching report status')
      assignments[event.assignmentId] = { ...record, status: wanted, claimedPaths: [] }
      changeRun({})
      break
    }
    case 'ASSIGNMENT_TAKEOVER': {
      const record = requireAssignment(assignments, event.assignmentId)
      assert(record.runId === event.runId, 'assignment run mismatch')
      assert(record.status === 'OPEN', 'only open assignments can be taken over')
      assert(runs[event.runId].agentIds.includes(event.byAgentId), 'takeover agent not in run')
      assert(event.reason.length > 0, 'takeover reason required')
      assignments[event.assignmentId] = { ...record, status: 'TAKEN_OVER', takenBy: event.byAgentId, takenReason: event.reason }
      changeRun({})
      break
    }
    case 'ASSIGNMENT_DEPENDENCY_DECLARED': {
      const record = requireAssignment(assignments, event.assignmentId)
      assert(record.runId === event.runId, 'assignment run mismatch')
      const dependency = requireAssignment(assignments, event.dependsOnId)
      assert(dependency.runId === event.runId, 'assignment run mismatch')
      assert(event.assignmentId !== event.dependsOnId, 'assignment cannot depend on itself')
      assert(record.status === 'OPEN', 'dependencies can only be declared on open assignments')
      assert(dependency.status === 'OPEN', 'dependencies can only target open assignments')
      // Adding assignment -> dependsOn creates a cycle iff dependsOn already reaches assignment.
      const stack = [event.dependsOnId]
      const visited = new Set<string>()
      while (stack.length > 0) {
        const node = stack.pop() as string
        if (node === event.assignmentId) assert(false, 'assignment dependency cycle')
        if (visited.has(node)) continue
        visited.add(node)
        const nodeRecord = assignments[node]
        if (nodeRecord) stack.push(...nodeRecord.dependsOn)
      }
      if (!record.dependsOn.includes(event.dependsOnId)) {
        assignments[event.assignmentId] = { ...record, dependsOn: [...record.dependsOn, event.dependsOnId].sort() }
      }
      changeRun({})
      break
    }
    case 'ASSIGNMENT_FILES_CLAIMED': {
      const record = requireAssignment(assignments, event.assignmentId)
      assert(record.runId === event.runId, 'assignment run mismatch')
      assert(record.status === 'OPEN', 'files can only be claimed by open assignments')
      assert(isSortedUnique(event.paths), 'invalid claimed paths')
      for (const claimed of event.paths) {
        for (const other of Object.values(assignments)) {
          if (other.assignmentId === event.assignmentId) continue
          if (other.runId !== event.runId) continue
          if (other.status !== 'OPEN' && other.status !== 'TAKEN_OVER') continue
          assert(!other.claimedPaths.includes(claimed),
            `file path ${claimed} already claimed by assignment ${other.assignmentId}`)
        }
      }
      const merged = [...record.claimedPaths]
      for (const claimed of event.paths) if (!merged.includes(claimed)) merged.push(claimed)
      assignments[event.assignmentId] = { ...record, claimedPaths: merged.sort() }
      changeRun({})
      break
    }
    case 'WORKTREE_ACQUIRED': {
      assert(!worktrees[event.worktreeId], 'worktree id already exists')
      const generation = generations[event.generationId]
      assert(generation !== undefined && generation.runId === event.runId, 'worktree generation mismatch')
      assert(event.path.length > 0 && event.branch.length > 0 && event.baseCommit.length > 0, 'worktree acquisition fields required')
      for (const existing of Object.values(worktrees)) {
        assert(existing.state !== 'ACTIVE' || existing.path !== event.path, 'worktree path already acquired')
      }
      worktrees[event.worktreeId] = { worktreeId: event.worktreeId, runId: event.runId, generationId: event.generationId,
        path: event.path, branch: event.branch, baseCommit: event.baseCommit, state: 'ACTIVE' }
      changeRun({})
      break
    }
    case 'WORKTREE_MERGED': {
      const record = requireWorktree(worktrees, event.worktreeId)
      assert(record.runId === event.runId, 'worktree run mismatch')
      assert(record.state === 'ACTIVE', 'merge requires an active worktree')
      worktrees[event.worktreeId] = { ...record, state: 'MERGED', mergeCommit: event.mergeCommit, mergeDigest: event.mergeDigest }
      changeRun({})
      break
    }
    case 'WORKTREE_ROLLED_BACK': {
      const record = requireWorktree(worktrees, event.worktreeId)
      assert(record.runId === event.runId, 'worktree run mismatch')
      assert(record.state === 'ACTIVE', 'committed worktree cannot roll back')
      assert(event.reason.length > 0, 'worktree rollback reason required')
      worktrees[event.worktreeId] = { ...record, state: 'ROLLED_BACK', rollbackRef: event.reason }
      changeRun({})
      break
    }
    case 'WORKTREE_RELEASED': {
      const record = requireWorktree(worktrees, event.worktreeId)
      assert(record.runId === event.runId, 'worktree run mismatch')
      assert(record.state !== 'RELEASED', 'worktree already released')
      worktrees[event.worktreeId] = { ...record, state: 'RELEASED' }
      changeRun({})
      break
    }
    case 'EVIDENCE_RECORDED': {
      assert(!evidence[event.evidenceId], 'evidence id already exists')
      requireRun()
      assert(event.requirementId.length > 0, 'evidence requirement required')
      assert(event.source.length > 0, 'evidence source required')
      assert(event.level === 'E0' || event.level === 'E1' || event.level === 'E2' || event.level === 'E3', 'unknown evidence level')
      assert((event.level === 'E2' || event.level === 'E3') ? (event.artifactDigest !== undefined && event.artifactDigest.length > 0) : true, 'E2/E3 evidence requires an artifact digest')
      assert(event.exitCode === undefined || Number.isSafeInteger(event.exitCode), 'invalid evidence exit code')
      assert(generations[event.producerGenerationId]?.runId === event.runId, 'evidence producer generation mismatch')
      evidence[event.evidenceId] = { evidenceId: event.evidenceId, runId: event.runId, requirementId: event.requirementId,
        level: event.level, source: event.source, command: event.command, exitCode: event.exitCode,
        artifactDigest: event.artifactDigest, producerGenerationId: event.producerGenerationId }
      const existing = requirements[event.requirementId]
      requirements[event.requirementId] = existing
        ? { ...existing, evidenceIds: existing.evidenceIds.includes(event.evidenceId) ? existing.evidenceIds : [...existing.evidenceIds, event.evidenceId] }
        : { requirementId: event.requirementId, runId: event.runId, evidenceIds: [event.evidenceId], verdict: 'NOT_VERIFIED' as const }
      changeRun({})
      break
    }
    case 'VERIFICATION_RECORDED': {
      const record = requirements[event.requirementId]
      assert(record !== undefined && record.runId === event.runId, 'unknown requirement')
      const item = evidence[event.evidenceId]
      assert(item !== undefined && item.requirementId === event.requirementId, 'verification evidence mismatch')
      assert(item.producerGenerationId !== event.verifierGenerationId, 'verification must be independent')
      assert(generations[event.verifierGenerationId]?.runId === event.runId, 'verification generation mismatch')
      requirements[event.requirementId] = { ...record, verdict: event.verdict, verifiedBy: event.verifierGenerationId }
      changeRun({})
      break
    }
    case 'ASSIGNMENT_ARBITRATED': {
      const record = requireAssignment(assignments, event.assignmentId)
      assert(record.runId === event.runId, 'assignment run mismatch')
      assert(record.status === 'OPEN', 'arbitration requires an open assignment')
      assert(event.ruling === 'REWORK' || event.ruling === 'ACCEPT' || event.ruling === 'ESCALATE', 'unknown arbitration ruling')
      assert(event.reason.length > 0, 'arbitration reason required')
      assert(generations[event.arbiterGenerationId]?.runId === event.runId, 'arbitration generation mismatch')
      assignments[event.assignmentId] = { ...record,
        arbitration: { ruling: event.ruling, by: event.arbiterGenerationId, reason: event.reason } }
      changeRun({})
      break
    }
    case 'REWORK_ORDERED': {
      const record = requireAssignment(assignments, event.assignmentId)
      assert(record.runId === event.runId, 'assignment run mismatch')
      assert(record.status === 'OPEN', 'rework requires an open assignment')
      assert(event.tier === 'MINOR' || event.tier === 'MAJOR' || event.tier === 'BLOCKER', 'unknown rework tier')
      assert(event.tier !== 'BLOCKER' || record.arbitration?.ruling === 'REWORK', 'blocker rework requires a lead rework ruling')
      assert(isSortedUnique(event.addedConstraints), 'invalid rework constraints')
      const merged = [...record.constraints]
      for (const added of event.addedConstraints) if (!merged.includes(added)) merged.push(added)
      assignments[event.assignmentId] = { ...record, briefRevision: record.briefRevision + 1, constraints: merged.sort() }
      changeRun({})
      break
    }
    case 'CONTEXT_CHECKPOINTED': {
      assert(!checkpoints[event.checkpointId], 'checkpoint id already exists')
      const generation = generations[event.generationId]
      assert(generation !== undefined && generation.runId === event.runId, 'checkpoint generation mismatch')
      assert(generation.epoch === event.epoch, 'checkpoint epoch mismatch')
      assert(event.digest.length > 0, 'checkpoint digest required')
      assert(Number.isSafeInteger(event.totalTokens) && event.totalTokens >= 0, 'checkpoint totals must be a non-negative integer')
      const summed = event.layerTokens.L0 + event.layerTokens.L1 + event.layerTokens.L2 + event.layerTokens.L3
      assert(summed === event.totalTokens, 'checkpoint layer tokens must sum to total')
      checkpoints[event.checkpointId] = { checkpointId: event.checkpointId, runId: event.runId,
        generationId: event.generationId, epoch: event.epoch, digest: event.digest,
        totalTokens: event.totalTokens, layerTokens: event.layerTokens }
      changeRun({})
      break
    }
    case 'BUDGET_RESERVED': {
      assert(runs[event.runId] !== undefined, 'budget run unknown')
      assert(!budgets[event.budgetId], 'budget id already exists')
      assert(Number.isSafeInteger(event.hardCostMicros) && event.hardCostMicros >= 0, 'budget cap must be a non-negative integer')
      assert(event.maxCalls === undefined || (Number.isSafeInteger(event.maxCalls) && event.maxCalls >= 0), 'budget max calls must be a non-negative integer')
      assert(event.maxRetries === undefined || (Number.isSafeInteger(event.maxRetries) && event.maxRetries >= 0), 'budget max retries must be a non-negative integer')
      budgets[event.budgetId] = { budgetId: event.budgetId, hardCostMicros: event.hardCostMicros,
        maxCalls: event.maxCalls, maxRetries: event.maxRetries, spentMicros: 0, reservedMicros: 0,
        approvedOverrunMicros: 0, openReservations: dictionary(), usage: dictionary() }
      changeRun({})
      break
    }
    case 'BUDGET_CALL_RESERVED': {
      const budget = requireBudget(budgets, event.budgetId)
      assert(!budget.openReservations[event.reservationId], 'budget reservation id already exists')
      assert(Number.isSafeInteger(event.reserveMicros) && event.reserveMicros > 0, 'budget reservation must be a positive integer')
      assert(budget.reservedMicros + event.reserveMicros <= budget.hardCostMicros + budget.approvedOverrunMicros,
        'budget reservation exceeds cap')
      const openReservations = dictionary(budget.openReservations)
      openReservations[event.reservationId] = event.reserveMicros
      budgets[event.budgetId] = { ...budget, reservedMicros: budget.reservedMicros + event.reserveMicros, openReservations }
      changeRun({})
      break
    }
    case 'BUDGET_RESERVATION_SETTLED': {
      const budget = requireBudget(budgets, event.budgetId)
      const reservation = budget.openReservations[event.reservationId]
      assert(reservation !== undefined, 'budget reservation unknown')
      assert(event.status === 'COMPLETED' || event.status === 'FAILED' || event.status === 'CANCELLED', 'unknown settlement status')
      assert(Number.isSafeInteger(event.attempt) && event.attempt >= 0, 'settlement attempt must be a non-negative integer')
      assert(Number.isSafeInteger(event.inputTokens) && event.inputTokens >= 0, 'settlement tokens must be non-negative integers')
      assert(Number.isSafeInteger(event.outputTokens) && event.outputTokens >= 0, 'settlement tokens must be non-negative integers')
      assert(Number.isSafeInteger(event.cacheReadTokens) && event.cacheReadTokens >= 0, 'settlement tokens must be non-negative integers')
      if (event.priced) {
        assert(Number.isSafeInteger(event.costMicros) && event.costMicros >= 0, 'settlement cost must be a non-negative integer')
        // Zero unauthorized overrun: the settled cost must fit cap + explicitly approved overrun.
        assert(event.status !== 'COMPLETED' || budget.spentMicros + event.costMicros <= budget.hardCostMicros + budget.approvedOverrunMicros,
          'budget settlement exceeds cap')
      } else {
        assert(event.status !== 'COMPLETED', 'unpriced spend cannot be settled')
      }
      const openReservations = dictionary(budget.openReservations)
      delete openReservations[event.reservationId]
      const usage = dictionary(budget.usage)
      const usageKey = `${event.providerRequestId}#${event.attempt}`
      usage[usageKey] = { runId: event.runId, providerRequestId: event.providerRequestId, attempt: event.attempt, route: event.route,
        priceVersion: event.priceVersion, inputTokens: event.inputTokens, outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens, costMicros: event.priced ? event.costMicros : 0, status: event.status }
      budgets[event.budgetId] = { ...budget,
        spentMicros: event.priced && event.status === 'COMPLETED' ? budget.spentMicros + event.costMicros : budget.spentMicros,
        reservedMicros: budget.reservedMicros - reservation, openReservations, usage }
      changeRun({})
      break
    }
    case 'BUDGET_OVERRUN_APPROVED': {
      const budget = requireBudget(budgets, event.budgetId)
      assert(Number.isSafeInteger(event.extraMicros) && event.extraMicros > 0, 'budget overrun must be a positive integer')
      assert(event.approvalId.length > 0 && event.approver.length > 0, 'budget overrun approval required')
      budgets[event.budgetId] = { ...budget, approvedOverrunMicros: budget.approvedOverrunMicros + event.extraMicros,
        approvalId: event.approvalId }
      changeRun({})
      break
    }
    case 'CACHE_ENTRY_RECORDED': {
      const key = `${event.runId}|${event.generationId}|${event.cacheKey}`
      assert(generations[event.generationId] !== undefined && generations[event.generationId].runId === event.runId,
        'cache generation mismatch')
      assert(!caches[key], 'cache entry already exists')
      assert(Number.isSafeInteger(event.savedCostMicros) && event.savedCostMicros >= 0, 'cache savings must be a non-negative integer')
      assert(Number.isSafeInteger(event.keepaliveCostMicros) && event.keepaliveCostMicros >= 0, 'cache keepalive cost must be a non-negative integer')
      assert(Number.isSafeInteger(event.expireAt), 'cache expiry must be an integer')
      assert(event.policyVersion.length > 0, 'cache policy version required')
      caches[key] = { runId: event.runId, generationId: event.generationId, cacheKey: event.cacheKey,
        savedCostMicros: event.savedCostMicros, keepaliveCostMicros: event.keepaliveCostMicros,
        expireAt: event.expireAt, policyVersion: event.policyVersion, keepaliveActive: true }
      changeRun({})
      break
    }
    case 'CACHE_KEEPALIVE_TICK': {
      const record = requireCache(caches, `${event.runId}|${event.generationId}|${event.cacheKey}`)
      assert(record.keepaliveActive, 'keepalive stopped for this cache entry')
      assert(Number.isSafeInteger(event.tickCostMicros) && event.tickCostMicros >= 0, 'keepalive tick cost must be a non-negative integer')
      caches[`${event.runId}|${event.generationId}|${event.cacheKey}`] = { ...record,
        keepaliveCostMicros: record.keepaliveCostMicros + event.tickCostMicros }
      changeRun({})
      break
    }
    case 'CACHE_KEEPALIVE_STOPPED': {
      const record = requireCache(caches, `${event.runId}|${event.generationId}|${event.cacheKey}`)
      assert(event.reason.length > 0, 'cache stop reason required')
      caches[`${event.runId}|${event.generationId}|${event.cacheKey}`] = { ...record, keepaliveActive: false }
      changeRun({})
      break
    }
    case 'DELEGATION_OUTCOME_RECORDED': {
      assert(runs[event.runId] !== undefined, 'delegation outcome run unknown')
      const assignment = assignments[event.assignmentId]
      assert(assignment !== undefined && assignment.runId === event.runId, 'delegation outcome assignment mismatch')
      assert(event.mode === 'DIRECT' || event.mode === 'DELEGATE', 'unknown delegation mode')
      assert(event.verdict === 'COMPLETED' || event.verdict === 'FAILED', 'unknown delegation verdict')
      assert(Number.isSafeInteger(event.costMicros) && event.costMicros >= 0, 'delegation cost must be a non-negative integer')
      const stats = delegation[event.mode]
      delegation[event.mode] = { attempts: stats.attempts + 1,
        failures: stats.failures + (event.verdict === 'FAILED' ? 1 : 0),
        spentMicros: stats.spentMicros + event.costMicros }
      changeRun({})
      break
    }
    case 'AUTHORITY_ISSUED': {
      // An authority profile is bound to exactly one generation at preparation time and is
      // immutable afterwards; Worker/Lead/Reviewer resume from this profile, never broader.
      assert(generations[event.generationId] !== undefined && generations[event.generationId].runId === event.runId, 'authority generation ownership mismatch')
      assert(!authorities[event.generationId], 'authority already issued')
      assert(isSortedUnique(event.toolScope) && isSortedUnique(event.writePaths) && isSortedUnique(event.approvalRequired), 'invalid authority scope')
      assert(event.approvalRequired.every(tool => event.toolScope.includes(tool)), 'approval requirement outside tool scope')
      authorities[event.generationId] = { generationId: event.generationId, runId: event.runId,
        toolScope: event.toolScope, writePaths: event.writePaths, approvalRequired: event.approvalRequired }
      changeRun({})
      break
    }
    default: invalid('unknown event type')
  }
  appliedEvents[event.eventId] = fingerprint
  const next = deepFreeze({ revision: state.revision + 1, seq: event.seq,
    runs: lazy.runs.materialize(), aliases: lazy.aliases.materialize(), generations: lazy.generations.materialize(),
    lineage: lazy.lineage.materialize(), effects: lazy.effects.materialize(), transitions: lazy.transitions.materialize(),
    authorities: lazy.authorities.materialize(), assignments: lazy.assignments.materialize(), reports: lazy.reports.materialize(),
    worktrees: lazy.worktrees.materialize(), evidence: lazy.evidence.materialize(), requirements: lazy.requirements.materialize(),
    checkpoints: lazy.checkpoints.materialize(), budgets: lazy.budgets.materialize(), caches: lazy.caches.materialize(),
    delegation,
    appliedEvents }, appliedEvents)
  return next
}
export function replayLifecycle(events: readonly LifecycleEvent[], initial = emptyLifecycleState()): LifecycleState {
  return events.reduce(reduceLifecycle, initial)
}
