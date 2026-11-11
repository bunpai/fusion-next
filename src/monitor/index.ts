import { FusionRunId, type LifecycleState, type ModelRoute, type RunStatus } from '../lifecycle/index.js'
import type { RunManager } from '../run-manager/index.js'

/** K02 live monitor read-models: the state-refresh, event-replay and recovery-interaction layer
 * of the run UI. Everything here is a pure projection over the journal — the real React surface
 * needs the Host runtime, so the views and guards stay deterministic and testable. Recovering
 * runs are never rendered as normally executing and risky user actions are gated while
 * recovery is in progress. */

export type RunView = {
  runId: string
  status: RunStatus
  task: string
  mode: string
  branchId?: string
  currentGenerationId?: string
  generations: Array<{ id: string; agentId: string; epoch: number; status: string; route: ModelRoute }>
  agents: readonly string[]
  lineage?: { parentRunId?: string; forkPointSeq?: number }
  unsettledEffects: string[]
  pendingApprovals: number
  activeLeases: number
}

export type BranchSummary = { branchId: string; parentBranchId?: string; forkPointSeq?: number }

export type RenderState = { runId: string; displayStatus: 'RUNNING' | 'SUSPENDED' | 'RECOVERING' | 'NEEDS_REPAIR' | 'STOPPED' | 'WAITING'; isRecovering: boolean }

export type UserAction = 'pause' | 'resume' | 'switch-model' | 'approve-budget' | 'view-effects' | 'replay-events'

const RISKY_ACTIONS: readonly UserAction[] = ['pause', 'switch-model', 'approve-budget']

const STOPPED: RunStatus[] = ['COMPLETED_SUCCESS', 'COMPLETED_FAILURE', 'CANCELLED', 'BUDGET_STOPPED']
const WAITING: RunStatus[] = ['WAITING_APPROVAL', 'WAITING_PROVIDER', 'VERIFYING', 'SUSPENDING']

const displayFor = (run: LifecycleState['runs'][string]): RenderState => {
  if (run.status === 'ACTIVATING') return { runId: run.id, displayStatus: run.restorePending ? 'RECOVERING' : 'RUNNING', isRecovering: Boolean(run.restorePending) }
  if (run.status === 'NEEDS_REPAIR') return { runId: run.id, displayStatus: 'NEEDS_REPAIR', isRecovering: false }
  if (STOPPED.includes(run.status)) return { runId: run.id, displayStatus: 'STOPPED', isRecovering: false }
  if (WAITING.includes(run.status)) return { runId: run.id, displayStatus: 'WAITING', isRecovering: false }
  if (run.status === 'SUSPENDED') return { runId: run.id, displayStatus: 'SUSPENDED', isRecovering: false }
  return { runId: run.id, displayStatus: 'RUNNING', isRecovering: false }
}

export class LiveMonitor {
  constructor(private readonly manager: RunManager) {}

  private requireRun(runId: string) {
    const run = this.manager.getRun(FusionRunId(runId))
    if (!run) throw new Error(`MONITOR_UNKNOWN_RUN: run ${runId} has no projection`)
    return run
  }

  runView(runId: string): RunView {
    const state = this.manager.getState()
    const run = this.requireRun(runId)
    const generations = Object.values(state.generations)
      .filter((generation) => generation.runId === run.id)
      .map((generation) => ({ id: generation.id, agentId: generation.agentId, epoch: generation.epoch, status: generation.status, route: generation.route }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const lineage = state.lineage[run.branchId ?? '']
    const unsettledEffects = Object.values(state.effects)
      .filter((effect) => effect.runId === run.id && effect.state !== 'SETTLED' && effect.state !== 'DISCARDED')
      .map((effect) => `${effect.effectId}:${effect.state}`)
      .sort()
    return {
      runId: run.id, status: run.status, task: run.taskId, mode: run.mode, branchId: run.branchId,
      currentGenerationId: run.currentGenerationId, generations, agents: run.agentIds,
      lineage: lineage ? { parentRunId: lineage.parentRunId, forkPointSeq: lineage.forkPointSeq } : undefined,
      unsettledEffects, pendingApprovals: run.pendingApprovalIds.length, activeLeases: run.activeLeaseIds.length,
    }
  }

  /** History/branch view: every known branch with its fork point, deterministically ordered. */
  branchView(): BranchSummary[] {
    const state = this.manager.getState()
    return Object.values(state.lineage)
      .map((lineage) => ({ branchId: lineage.branchId, parentBranchId: lineage.parentBranchId, forkPointSeq: lineage.forkPointSeq }))
      .sort((a, b) => a.branchId.localeCompare(b.branchId))
  }

  /** Replayable progress: journaled events from a durable cursor (at-least-once). */
  replayFrom(cursor: number, limit = 100) {
    return { events: this.manager.readEventsSince(cursor, limit) }
  }

  /** Transition/recovery view: journaled transition markers plus what still blocks switching. */
  transitionProgress(runId: string): { transitions: Array<{ id: string; phase: string; error?: string }>; blockedByEffects: string[] } {
    const state = this.manager.getState()
    this.requireRun(runId)
    const transitions = Object.values(state.transitions)
      .filter((transition) => transition.runId === runId)
      .map((transition) => ({ id: transition.transitionId, phase: transition.phase, error: transition.error }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const blockedByEffects = Object.values(state.effects)
      .filter((effect) => effect.runId === runId && (effect.state === 'INTENT' || effect.state === 'EXECUTING' || effect.state === 'NEEDS_REPAIR'))
      .map((effect) => `${effect.effectId}:${effect.state}`)
      .sort()
    return { transitions, blockedByEffects }
  }

  renderState(runId: string): RenderState {
    return displayFor(this.requireRun(runId))
  }

  /** Safe user interaction gate: while a run is recovering, only passive actions are allowed. */
  assertUserActionAllowed(runId: string, action: UserAction): boolean {
    const state = this.renderState(runId)
    if (state.isRecovering && RISKY_ACTIONS.includes(action)) {
      throw new Error(`RECOVERY_IN_PROGRESS: run ${runId} is recovering; action ${action} is blocked until the run is ACTIVE`)
    }
    return true
  }
}
