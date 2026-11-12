import type { SqliteFusionStore } from '../task/sqlite-store.js'
import type { PhysicalRoute } from '../contracts.js'

/**
 * Per-session model pair (plan/execute pickers): the session's *normal* Host
 * model selection is the planner (Lead) and the composer dock's second picker
 * persists the executor (Worker) here, bound to the session like the native
 * selection — not via a third pseudo-model.
 *
 * `lead` mirrors the journal's physical selection so worker-side route()
 * lookups can prefer the session pair over the frozen binding profile.
 */
export interface SessionPair {
  readonly schemaVersion: 1
  readonly lead?: PhysicalRoute
  readonly worker?: PhysicalRoute
}

const key = (sessionId: string) => `pair:${sessionId}`

export function readSessionPair(store: SqliteFusionStore, sessionId: string): { revision: number; pair: SessionPair } | undefined {
  const row = store.readDocument(key(sessionId))
  if (!row) return undefined
  const value = row.value as SessionPair
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) {
    throw new Error(`Invalid session pair document for ${sessionId}`)
  }
  return { revision: row.revision, pair: value }
}

export function writeSessionPair(store: SqliteFusionStore, sessionId: string, revision: number, pair: SessionPair): number {
  return store.writeDocument(key(sessionId), revision, pair)
}

/** Update only the lead field, preserving a worker already configured. */
export function syncSessionPairLead(store: SqliteFusionStore, sessionId: string, lead: PhysicalRoute): void {
  const row = readSessionPair(store, sessionId)
  const prior = row?.pair
  if (prior?.lead?.provider === lead.provider && prior.lead.model === lead.model
    && prior.lead.reasoningEffort === lead.reasoningEffort) return
  writeSessionPair(store, sessionId, row?.revision ?? 0, { schemaVersion: 1, ...(prior ?? {}), lead })
}
