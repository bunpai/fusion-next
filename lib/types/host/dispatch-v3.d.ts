import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SqliteFusionStore } from '../task/sqlite-store.js';
import type { SessionBinding } from './bindings.js';
import type { NativeWorkerTransport } from './native-worker.js';
import type { NativeFusionActivity } from './native-activity.js';
import { type AuditBundle } from './audit-v3.js';
/**
 * fusion_dispatch — the single Lead→Worker handoff. Replaces the legacy
 * delegate/rework/wait/submit_result ceremony: one tool call starts or
 * continues the durable worker child, blocks on settle() inside the call
 * (no 75s poll, no split turns), audits the workspace deterministically,
 * self-repairs verification failures through the same worker, and returns
 * a bounded AuditBundle the Lead reviews in one step.
 */
export interface DispatchArgs {
    readonly instruction?: string;
    readonly verify_commands?: readonly string[];
    readonly reset_worker?: boolean;
}
export interface DispatchDeps {
    readonly ctx: Context;
    readonly store: SqliteFusionStore;
    readonly transport: NativeWorkerTransport;
    readonly activity: NativeFusionActivity;
    readonly workerTools: readonly string[];
}
export declare function runDispatch(deps: DispatchDeps, agent: Agent, binding: SessionBinding, args: DispatchArgs, signal: AbortSignal, callId?: string): Promise<AuditBundle>;
/** Live-dispatch check for the prefix router: worker work in flight keeps the Lead streaming. */
export declare function dispatchInFlight(store: SqliteFusionStore, taskId: import('../contracts.js').TaskId): boolean;
