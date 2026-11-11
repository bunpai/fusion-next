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
export type LifecycleEvent = { readonly schemaVersion: 1; readonly eventId: string; readonly seq: number; readonly expectedRevision: number } &
  (Created | Forked | Bound | RunChange | Prepared | GenerationChange | SwitchCommitted | EffectIntent | EffectTransition)
export interface LifecycleState {
  readonly revision: number
  readonly seq: number
  readonly runs: Readonly<Record<string, FusionRun>>
  readonly aliases: Readonly<Record<string, SessionAlias>>
  readonly generations: Readonly<Record<string, AgentGeneration>>
  readonly lineage: Readonly<Record<string, BranchLineage>>
  readonly effects: Readonly<Record<string, EffectRecord>>
  /** Event id -> canonical payload; replay duplicate with differing payload is a conflict. */
  readonly appliedEvents: Readonly<Record<string, string>>
}
const dictionary = <T>(source?: Readonly<Record<string, T>>): Record<string, T> => Object.assign(Object.create(null) as Record<string, T>, source)
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}
const stable = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item)
export const emptyLifecycleState = (): LifecycleState => deepFreeze({ revision: 0, seq: 0, runs: dictionary(), aliases: dictionary(), generations: dictionary(), lineage: dictionary(), effects: dictionary(), appliedEvents: dictionary() })
const invalid = (reason: string): never => { throw new Error(`lifecycle conflict: ${reason}`) }
function assert(condition: unknown, reason: string): asserts condition { if (!condition) invalid(reason) }

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
  const runs = dictionary(state.runs), aliases = dictionary(state.aliases), generations = dictionary(state.generations), lineage = dictionary(state.lineage), effects = dictionary(state.effects)
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
    default: invalid('unknown event type')
  }
  return deepFreeze({ revision: state.revision + 1, seq: event.seq, runs, aliases, generations, lineage, effects,
    appliedEvents: dictionary({ ...state.appliedEvents, [event.eventId]: fingerprint }) })
}
export function replayLifecycle(events: readonly LifecycleEvent[], initial = emptyLifecycleState()): LifecycleState {
  return events.reduce(reduceLifecycle, initial)
}
