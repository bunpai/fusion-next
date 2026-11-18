import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, ModelModality, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { PhysicalRoute } from '../contracts.js';
import type { ResolvedProfile } from '../profile/resolve.js';
import type { FusionCoordinator } from './coordinator.js';
export declare const FUSION_NEXT_PROVIDER = "fusion-next";
export declare const FUSION_NEXT_MODEL = "auto";
export declare const isFusionSelection: (route: {
    provider?: string;
    model?: string;
} | undefined) => boolean;
/** Resolves the configured Lead's declared input modalities; undefined means unconfigured or unverifiable. */
export type LeadInputModalities = () => Promise<readonly ModelModality[] | undefined>;
/** Streams one request through the route's physical adapter via the LLM runtime. */
export type FusionDispatch = (options: GenerateOptions, route: PhysicalRoute) => AsyncIterable<StreamChunk>;
export type LeadModelInfo = () => Promise<LlmResolvedModelInfo | undefined>;
/**
 * Virtual local provider: the session and agent model state stay on
 * fusion-next/auto (UI identity + journal intent), while every stream is
 * dispatched through the configured Lead's physical route. Auxiliary callers
 * (session title) take the same route and never block a turn.
 */
export declare class FusionCatalogAdapter extends LlmAdapter {
    private readonly leadModelInfo?;
    private readonly dispatch?;
    private readonly resolveLead?;
    constructor(leadModelInfo?: LeadModelInfo | undefined, dispatch?: FusionDispatch | undefined, resolveLead?: ((options?: GenerateOptions) => PhysicalRoute | undefined) | undefined);
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/** Public native lifecycle integration. No model-menu replacement or Host patch. */
export declare function installNativeFusionSelection(ctx: Context, input: {
    coordinator(): FusionCoordinator | undefined;
    profile(): ResolvedProfile | undefined;
    selection(agent: Agent): PhysicalRoute | undefined;
    /**
     * Optional C01 activation seam, invoked once a session commits to Fusion.
     * The Host adapter is supplied by later integration tasks; when absent this
     * installer keeps its previous behavior unchanged (fail-closed, no Host calls).
     */
    activate?(sessionId: string): void;
    /**
     * Registry of physical routes the scope layer applied via agent.model.select().
     * 0.2.2 journals every select, so the journal's latest model/selection becomes
     * our own physical echo; without this registry the echo reads as a user's menu
     * action and clears the freshly created Fusion binding mid-turn. The caller
     * owns the map because the scope installer marks it through its own callback
     * chain (scopes → coordinator options → entry).
     */
    appliedRoutes?: {
        read(agentId: string): {
            provider: string;
            model: string;
        } | undefined;
    };
    /**
     * S03 seam: a user switch away from Fusion suspends the journal-backed run.
     * Called when the effective selection leaves Fusion while a binding is
     * selected; the caller journals RUN_SUSPEND_REQUESTED/RUN_SUSPENDED (or the
     * blockers that make the transition visible). Best-effort like activate.
     */
    suspend?(sessionId: string): void;
    /**
     * Session-pair seam: the per-session executor (Worker) route chosen in the
     * composer dock picker. When it resolves to a route and the session's
     * selection is a normal physical model, the session is a Fusion session —
     * the host selection is the planner (Lead) and this route is the executor.
     * When it returns undefined the session is a plain session (or the legacy
     * 'Fusion Next · 自动' path, which keeps the globally configured pair).
     */
    workerOf?(sessionId: string): PhysicalRoute | undefined;
    /**
     * Resolve the per-session profile for the physical-selection + worker-pair
     * path (planner = the session's physical host selection). Falls back to
     * profile() when absent; returning undefined blocks binding creation.
     */
    sessionProfile?(sessionId: string, lead: PhysicalRoute, worker: PhysicalRoute): ResolvedProfile | undefined;
    /**
     * Called when a Fusion-bound session's physical selection changes while the
     * executor pair stays configured — the host selection IS the planner, so
     * this is a planner switch, not a Fusion exit. The caller syncs the
     * session-pair document's lead field (idempotent compare before write).
     */
    leadChanged?(sessionId: string, lead: PhysicalRoute): void;
    /**
     * Lazily create the coordinator for a session-pair activation when no
     * configured profile or previously selected binding warmed the runtime yet
     * (fresh installs pair per session before any global pair exists). Resolved
     * with the session profile built from the current lead+worker routes.
     */
    ensureCoordinator?(sessionId: string, lead: PhysicalRoute, worker: PhysicalRoute): Promise<void>;
}): () => void;
