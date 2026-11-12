import type { SqliteFusionStore } from '../task/sqlite-store.js';
import type { PhysicalRoute } from '../contracts.js';
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
    readonly schemaVersion: 1;
    readonly lead?: PhysicalRoute;
    readonly worker?: PhysicalRoute;
}
export declare function readSessionPair(store: SqliteFusionStore, sessionId: string): {
    revision: number;
    pair: SessionPair;
} | undefined;
export declare function writeSessionPair(store: SqliteFusionStore, sessionId: string, revision: number, pair: SessionPair): number;
/** Update only the lead field, preserving a worker already configured. */
export declare function syncSessionPairLead(store: SqliteFusionStore, sessionId: string, lead: PhysicalRoute): void;
