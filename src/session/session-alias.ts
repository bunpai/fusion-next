/** C01 session alias resolution: stable 1:1 host-session → Fusion run binding. */
import { FusionRunId, SessionAliasId, type RunMode, type SessionAlias } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'

export interface AliasCreateIntent {
  readonly kind: 'create'
  readonly taskId: string
  readonly budgetId: string
  readonly mode: RunMode
  readonly branchId?: string
}
export type AliasIntent = AliasCreateIntent | { readonly kind: 'restore' }
export interface AliasResolution {
  readonly alias: SessionAlias
  readonly runId: ReturnType<typeof FusionRunId>
  readonly created: boolean
}

const needsRepair = (message: string): never => { throw new Error(`NEEDS_REPAIR: ${message}`) }

/**
 * Resolves the stable alias for a host session, creating the Fusion run when the
 * session has none. The binding is 1:1: an existing alias is returned unchanged;
 * creating a second run for a bound session or rewriting the binding is rebind
 * territory (C02+) and is refused here. Run, task and budget identities are
 * derived from the intent, so an identical retry replays the same committed
 * event idempotently while a different intent conflicts instead of silently
 * rebinding. The model route is NOT part of run creation: routes are frozen per
 * agent generation at GENERATION_PREPARED, not at alias resolution. History
 * sessions activate only from an explicit caller intent — the last physical
 * request header is never treated as the user's model choice.
 */
export function resolveOrCreateAlias(manager: RunManager, hostSessionId: string, intent: AliasIntent): AliasResolution {
  const sessionId = SessionAliasId(hostSessionId)
  const existing = manager.getAlias(sessionId)
  if (existing) return { alias: existing, runId: existing.runId, created: false }
  if (intent.kind === 'restore') {
    // Explicit throw narrows the union for the branchId access below.
    throw new Error(`NEEDS_REPAIR: no Fusion session binding for host session ${hostSessionId}; refusing to fabricate a run`)
  }
  if (!intent.taskId.trim() || !intent.budgetId.trim()) {
    needsRepair('task and budget identities are required for activation')
  }
  const runId = FusionRunId(`fusion-run-${hostSessionId}`)
  const input = {
    schemaVersion: 1, eventId: `fusion/session-alias/${hostSessionId}/created`, type: 'RUN_CREATED',
    runId, hostSessionId: sessionId, taskId: intent.taskId, budgetId: intent.budgetId, mode: intent.mode,
    ...(intent.branchId ? { branchId: intent.branchId } : {}),
  } as RunEventInput
  manager.append(input, 0)
  const alias = manager.getAlias(sessionId)
  if (!alias || alias.runId !== runId) {
    // Explicit throw keeps the undefined-narrowing local to this branch.
    throw new Error('NEEDS_REPAIR: alias projection missing after run creation')
  }
  return { alias, runId, created: true }
}
