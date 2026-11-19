import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { TaskId, type Role } from '../contracts.js';
import type { SqliteFusionStore } from '../task/sqlite-store.js';
import type { ResolvedProfile } from '../profile/resolve.js';
import { BindingRepository, type SessionBinding } from './bindings.js';
import { NativeWorkerTransport } from './native-worker.js';
import { NativeFusionScopes } from './native-scopes.js';
import { NativeEffects } from './native-effects.js';
import { NativeCacheKeepalive } from './native-keepalive.js';
import { NativeAuxiliaryRequests } from './native-auxiliary.js';
import { NativeFusionActivity } from './native-activity.js';
import { type RuntimeV3 } from './runtime-v3.js';
/**
 * Fusion Coordinator v3 — one tool (fusion_dispatch), one durable worker
 * child per task, zero ceremony. Replaces the 11-tool workflow and its
 * sandbox/lease/review machinery with:
 *   1. scopes for role prompt + tool surface + route (unchanged mechanism),
 *   2. fusion_dispatch = start/continue + uninterrupted settle + deterministic audit,
 *   3. subagent interception rerouting read-only exploration to the executor,
 *   4. soft post-execute reminders instead of hard guards (host sandbox is the boundary).
 */
export interface CoordinatorOptions {
    readonly profile: ResolvedProfile;
    readonly workerTools: readonly string[];
}
export interface CoordinatorOwner {
    readonly binding: SessionBinding;
    readonly role: Role;
}
export declare class FusionCoordinator {
    #private;
    private readonly ctx;
    private readonly store;
    private readonly options;
    readonly transport: NativeWorkerTransport;
    readonly auxiliary: NativeAuxiliaryRequests;
    readonly activity: NativeFusionActivity;
    readonly bindings: BindingRepository;
    readonly scopes: NativeFusionScopes;
    readonly effects: NativeEffects;
    readonly keepalive: NativeCacheKeepalive;
    constructor(ctx: Context, store: SqliteFusionStore, options: CoordinatorOptions);
    owner(agent: Agent): CoordinatorOwner | undefined;
    selectBeforeAssembly(agent: Agent, resolved: ResolvedProfile): void;
    select(agent: Agent, resolved: ResolvedProfile): Promise<void>;
    clear(agent: Agent, options?: {
        abandon?: boolean;
    }): Promise<void>;
    pause(agent: Agent): Promise<void>;
    resume(agent: Agent): Promise<void>;
    reconcile(agent: Agent, options: {
        commandId?: string;
        note?: string;
        effectsStopped?: boolean;
    }): Promise<void>;
    state(taskId: TaskId): RuntimeV3 | undefined;
    close(): Promise<void>;
}
