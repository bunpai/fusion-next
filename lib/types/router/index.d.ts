import type { ModelRoute } from '../lifecycle/index.js';
/** G01 Dynamic Router. Model tiers are LOGICAL capability levels (plan §7 line 187), never
 * vendor names: L0 Direct / L1 Economy / L2 Advanced / L3 Frontier. The Router only proposes:
 * every route change is committed by the TransitionService under the D03 safety boundary, so
 * this module is pure and journal-free. */
export declare const ROUTER_CHECKPOINTS: readonly ["TASK_START", "AFTER_EXPLORE", "AFTER_PLAN", "DURING_EXECUTE", "DURING_COMPACTION", "BEFORE_FINALIZE"];
export type RouterCheckpoint = (typeof ROUTER_CHECKPOINTS)[number];
/** L0 Direct is the local direct-execution path (no provider model); L1..L3 are model tiers. */
export type ModelTier = 'L0' | 'L1' | 'L2' | 'L3';
export interface RouteCandidate {
    route: ModelRoute;
    tier: ModelTier;
    tools: string[];
    contextWindow: number;
    modalities: string[];
    available: boolean;
    /** Abstract price index; lower is cheaper. Unknown price must be treated as expensive. */
    priceIndex: number;
    /** User-stated preference bonus (higher is better), from the user policy surface. */
    userPreferenceRank: number;
}
export interface UserPolicy {
    /** Hard tier allow-list from the user; nothing outside it is ever selected. */
    allowedTiers: readonly ModelTier[];
}
export interface FilterContext {
    requiredTools: readonly string[];
    minContextTokens: number;
    requiredModalities: readonly string[];
    userPolicy: UserPolicy;
}
export type ExecuteSignal = 'failure' | 'stall' | 'quota';
export interface RouteDecision {
    checkpoint: RouterCheckpoint;
    /** Tier of the currently active generation, for compaction/escalation guards. */
    currentTier: ModelTier;
    /** Tokens of the warm prefix cache; switching away re-pays them (plan line 220). */
    warmCacheTokens: number;
    /** Route whose cache is warm (omit when the current generation has no cache). */
    currentRoute?: ModelRoute;
    signals?: readonly ExecuteSignal[];
}
/** Hard filter (plan line 187): permissions/tools/context window/modality/availability/user
 * policy, in that order of concern; a candidate failing ANY is excluded before ranking. */
export declare function hardFilter(candidates: readonly RouteCandidate[], context: FilterContext): RouteCandidate[];
/** Risk-adjusted ranking: hard filter first, then deterministic score, then stable tie-breaks
 * (higher tier, then canonical route id). Same input → same order, always. */
export declare function rankCandidates(candidates: readonly RouteCandidate[], context: FilterContext, decision?: RouteDecision): RouteCandidate[];
/** Deterministic selection for a checkpoint. Semantics:
 * - no decision context → best-ranked candidate (or undefined for an empty pool);
 * - DURING_COMPACTION never auto-upgrades (plan line 220): candidates above the current tier
 *   are excluded and the current route is kept whenever it still passes the hard filter;
 * - DURING_EXECUTE with a failure/stall/quota signal may escalate to the best-ranked candidate
 *   within the user's tier policy;
 * - otherwise the current route is kept while it stays valid (prefix-cache stability). */
export declare function selectRoute(candidates: readonly RouteCandidate[], context: FilterContext, decision?: RouteDecision): RouteCandidate | undefined;
