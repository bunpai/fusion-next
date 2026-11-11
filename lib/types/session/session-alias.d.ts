/** C01 session alias resolution: stable 1:1 host-session → Fusion run binding. */
import { FusionRunId, type RunMode, type SessionAlias } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
export interface AliasCreateIntent {
    readonly kind: 'create';
    readonly taskId: string;
    readonly budgetId: string;
    readonly mode: RunMode;
    readonly branchId?: string;
}
export type AliasIntent = AliasCreateIntent | {
    readonly kind: 'restore';
};
export interface AliasResolution {
    readonly alias: SessionAlias;
    readonly runId: ReturnType<typeof FusionRunId>;
    readonly created: boolean;
}
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
export declare function resolveOrCreateAlias(manager: RunManager, hostSessionId: string, intent: AliasIntent): AliasResolution;
