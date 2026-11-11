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
  currentGenerationId?: AgentGenerationId
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
type GenerationChange = { type: 'GENERATION_ACTIVATED' | 'GENERATION_DRAINING' | 'GENERATION_RETIRED' | 'GENERATION_CALLBACK'; runId: FusionRunId; generationId: AgentGenerationId }
/** Internal projected domain events, NOT discovered or promised Host SDK events. */
export type LifecycleEvent = { readonly schemaVersion: 1; readonly eventId: string; readonly seq: number; readonly expectedRevision: number } &
  (Created | Forked | Bound | RunChange | Prepared | GenerationChange)
export interface LifecycleState {
  readonly revision: number
  readonly seq: number
  readonly runs: Readonly<Record<string, FusionRun>>
  readonly aliases: Readonly<Record<string, SessionAlias>>
  readonly generations: Readonly<Record<string, AgentGeneration>>
  readonly lineage: Readonly<Record<string, BranchLineage>>
  /** Event id -> canonical payload; replay duplicate with differing payload is a conflict. */
  readonly appliedEvents: Readonly<Record<string, string>>
}
export const emptyLifecycleState = (): LifecycleState => ({ revision: 0, seq: 0, runs: {}, aliases: {}, generations: {}, lineage: {}, appliedEvents: {} })
const invalid = (reason: string): never => { throw new Error(`lifecycle conflict: ${reason}`) }
function assert(condition: unknown, reason: string): asserts condition { if (!condition) invalid(reason) }

export function reduceLifecycle(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  assert(event.schemaVersion === 1, 'unsupported event schema version')
  assert(Boolean(event.eventId?.trim()), 'empty event id')
  const fingerprint = JSON.stringify(event)
  const previous = state.appliedEvents[event.eventId]
  if (previous !== undefined) {
    assert(previous === fingerprint, 'event id reused with different contents')
    return state
  }
  assert(event.seq === state.seq + 1, `out-of-order seq: expected ${state.seq + 1}`)
  assert(event.expectedRevision === state.revision, `stale revision: expected ${state.revision}`)
  const runs = { ...state.runs }, aliases = { ...state.aliases }, generations = { ...state.generations }, lineage = { ...state.lineage }
  const current = runs[event.runId]
  const requireRun = (): FusionRun => current ?? invalid('unknown run')
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
    assert(!Object.values(runs).some(r => r.taskId === data.taskId || r.budgetId === data.budgetId), 'task/budget identity must be unique')
    runs[data.runId] = { id: data.runId, hostSessionId: data.hostSessionId, branchId: data.branchId, taskId: data.taskId,
      mode: data.mode, status, revision: 1, budgetId: data.budgetId, agentIds, pendingApprovalIds: [], activeLeaseIds: [], hasActivated: false }
    aliases[data.hostSessionId] = { hostSessionId: data.hostSessionId, runId: data.runId, branchId: data.branchId,
      ...(data.type === 'SESSION_FORKED' ? { forkPointSeq: data.forkPointSeq } : {}), selectionStatus: 'INACTIVE', revision: 1 }
  }
  switch (event.type) {
    case 'RUN_CREATED': makeRun(event, 'ACTIVATING'); break
    case 'SESSION_FORKED': {
      const source = runs[event.sourceRunId]
      assert(source?.hostSessionId === event.sourceHostSessionId, 'fork source ownership mismatch')
      assert(event.branchId && !lineage[event.branchId] && event.branchId !== source.branchId, 'fork branch identity conflict')
      assert(Number.isSafeInteger(event.forkPointSeq) && event.forkPointSeq >= 0 && event.forkPointSeq <= state.seq, 'invalid fork point')
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
      changeRun({ status: 'RUNNING', restorePending: false }); changeAlias(event.hostSessionId, 'ACTIVE'); break
    case 'GENERATION_PREPARED': {
      const owner = requireRun()
      assert(!generations[event.generationId], 'generation id already exists')
      assert(event.agentId && event.sessionId && event.route.provider && event.route.model && event.route.capabilityDigest, 'incomplete generation')
      const predecessors = Object.values(generations).filter(g => g.runId === event.runId && g.agentId === event.agentId)
      assert(predecessors.every(g => g.status === 'RETIRED'), 'agent has unretired generation')
      assert(event.epoch === Math.max(0, ...predecessors.map(g => g.epoch)) + 1, 'stale generation epoch')
      assert(owner.status === 'RUNNING', 'run is not active')
      generations[event.generationId] = { id: event.generationId, runId: event.runId, agentId: event.agentId, sessionId: event.sessionId, route: event.route, epoch: event.epoch, status: 'PREPARING' }
      changeRun({ agentIds: owner.agentIds.includes(event.agentId) ? owner.agentIds : [...owner.agentIds, event.agentId] })
      break
    }
    case 'GENERATION_ACTIVATED':
    case 'GENERATION_DRAINING':
    case 'GENERATION_RETIRED':
    case 'GENERATION_CALLBACK': {
      const gen = generations[event.generationId]
      assert(gen?.runId === event.runId, 'generation ownership mismatch')
      if (event.type === 'GENERATION_CALLBACK') {
        assert(gen.status === 'ACTIVE' && requireRun().status === 'RUNNING' && requireRun().currentGenerationId === gen.id, 'stale generation callback fenced')
        changeRun({}); break
      }
      const expected = event.type === 'GENERATION_ACTIVATED' ? 'PREPARING' : event.type === 'GENERATION_DRAINING' ? 'ACTIVE' : 'DRAINING'
      assert(gen.status === expected, `illegal generation transition from ${gen.status}`)
      if (event.type === 'GENERATION_ACTIVATED') {
        assert(requireRun().status === 'RUNNING' && !requireRun().currentGenerationId, 'current generation already owned')
        changeRun({ currentGenerationId: gen.id })
      } else if (event.type === 'GENERATION_RETIRED') {
        assert(requireRun().currentGenerationId === gen.id, 'retiring non-current generation')
        changeRun({ currentGenerationId: undefined })
      } else changeRun({})
      generations[gen.id] = { ...gen, status: event.type === 'GENERATION_ACTIVATED' ? 'ACTIVE' : event.type === 'GENERATION_DRAINING' ? 'DRAINING' : 'RETIRED' }
      break
    }
    default: invalid('unknown event type')
  }
  return { revision: state.revision + 1, seq: event.seq, runs, aliases, generations, lineage,
    appliedEvents: { ...state.appliedEvents, [event.eventId]: fingerprint } }
}
export function replayLifecycle(events: readonly LifecycleEvent[], initial = emptyLifecycleState()): LifecycleState {
  return events.reduce(reduceLifecycle, initial)
}
