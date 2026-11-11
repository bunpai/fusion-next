import type { ModelRoute } from '../lifecycle/index.js'

/** G01 Dynamic Router. Model tiers are LOGICAL capability levels (plan §7 line 187), never
 * vendor names: L0 Direct / L1 Economy / L2 Advanced / L3 Frontier. The Router only proposes:
 * every route change is committed by the TransitionService under the D03 safety boundary, so
 * this module is pure and journal-free. */

export const ROUTER_CHECKPOINTS = [
  'TASK_START', 'AFTER_EXPLORE', 'AFTER_PLAN', 'DURING_EXECUTE', 'DURING_COMPACTION', 'BEFORE_FINALIZE',
] as const

export type RouterCheckpoint = (typeof ROUTER_CHECKPOINTS)[number]

/** L0 Direct is the local direct-execution path (no provider model); L1..L3 are model tiers. */
export type ModelTier = 'L0' | 'L1' | 'L2' | 'L3'

export interface RouteCandidate {
  route: ModelRoute
  tier: ModelTier
  tools: string[]
  contextWindow: number
  modalities: string[]
  available: boolean
  /** Abstract price index; lower is cheaper. Unknown price must be treated as expensive. */
  priceIndex: number
  /** User-stated preference bonus (higher is better), from the user policy surface. */
  userPreferenceRank: number
}

export interface UserPolicy {
  /** Hard tier allow-list from the user; nothing outside it is ever selected. */
  allowedTiers: readonly ModelTier[]
}

export interface FilterContext {
  requiredTools: readonly string[]
  minContextTokens: number
  requiredModalities: readonly string[]
  userPolicy: UserPolicy
}

export type ExecuteSignal = 'failure' | 'stall' | 'quota'

export interface RouteDecision {
  checkpoint: RouterCheckpoint
  /** Tier of the currently active generation, for compaction/escalation guards. */
  currentTier: ModelTier
  /** Tokens of the warm prefix cache; switching away re-pays them (plan line 220). */
  warmCacheTokens: number
  /** Route whose cache is warm (omit when the current generation has no cache). */
  currentRoute?: ModelRoute
  signals?: readonly ExecuteSignal[]
}

const TIER_VALUE: Record<ModelTier, number> = { L0: 0, L1: 1, L2: 2, L3: 3 }
/** One point of tier value equals 1000 price-index units; a warm cache re-pays 1/1000 of its
 * tokens per unit of score. All constants are fixed — the selection is fully deterministic. */
const PRICE_WEIGHT = 1
const TIER_WEIGHT = 1000
const CACHE_WEIGHT = 0.001

/** Hard filter (plan line 187): permissions/tools/context window/modality/availability/user
 * policy, in that order of concern; a candidate failing ANY is excluded before ranking. */
export function hardFilter(candidates: readonly RouteCandidate[], context: FilterContext): RouteCandidate[] {
  return candidates.filter(entry =>
    context.requiredTools.every(tool => entry.tools.includes(tool)) &&
    entry.contextWindow >= context.minContextTokens &&
    context.requiredModalities.every(modality => entry.modalities.includes(modality)) &&
    entry.available &&
    context.userPolicy.allowedTiers.includes(entry.tier))
}

const canonicalRoute = (route: ModelRoute): string => `${route.provider}/${route.model}`
const canonical = (entry: RouteCandidate): string => canonicalRoute(entry.route)

const scoreOf = (entry: RouteCandidate, decision?: RouteDecision): number => {
  const value = TIER_VALUE[entry.tier] * TIER_WEIGHT - entry.priceIndex * PRICE_WEIGHT + entry.userPreferenceRank * TIER_WEIGHT
  const warm = decision?.currentRoute !== undefined && canonicalRoute(decision.currentRoute) === canonical(entry)
  const switchPenalty = warm ? 0 : (decision?.warmCacheTokens ?? 0) * CACHE_WEIGHT
  return value - switchPenalty
}

/** Risk-adjusted ranking: hard filter first, then deterministic score, then stable tie-breaks
 * (higher tier, then canonical route id). Same input → same order, always. */
export function rankCandidates(candidates: readonly RouteCandidate[], context: FilterContext,
  decision?: RouteDecision): RouteCandidate[] {
  return [...hardFilter(candidates, context)].sort((a, b) => {
    const scoreDelta = scoreOf(b, decision) - scoreOf(a, decision)
    if (scoreDelta !== 0) return scoreDelta
    const tierDelta = TIER_VALUE[b.tier] - TIER_VALUE[a.tier]
    if (tierDelta !== 0) return tierDelta
    return canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0
  })
}

const isEscalationSignal = (decision?: RouteDecision): boolean =>
  decision?.signals?.some(signal => signal === 'failure' || signal === 'stall' || signal === 'quota') === true

/** Deterministic selection for a checkpoint. Semantics:
 * - no decision context → best-ranked candidate (or undefined for an empty pool);
 * - DURING_COMPACTION never auto-upgrades (plan line 220): candidates above the current tier
 *   are excluded and the current route is kept whenever it still passes the hard filter;
 * - DURING_EXECUTE with a failure/stall/quota signal may escalate to the best-ranked candidate
 *   within the user's tier policy;
 * - otherwise the current route is kept while it stays valid (prefix-cache stability). */
export function selectRoute(candidates: readonly RouteCandidate[], context: FilterContext,
  decision?: RouteDecision): RouteCandidate | undefined {
  let pool = hardFilter(candidates, context)
  const wantedRoute = decision?.currentRoute
  const current = wantedRoute === undefined
    ? undefined
    : pool.find(entry => canonical(entry) === canonicalRoute(wantedRoute))
  if (decision?.checkpoint === 'DURING_COMPACTION') {
    const allowed = pool.filter(entry => TIER_VALUE[entry.tier] <= TIER_VALUE[decision.currentTier])
    return current !== undefined && allowed.includes(current) ? current : allowed[0]
  }
  if (!isEscalationSignal(decision) && current !== undefined) return current
  const ranked = rankCandidates(pool, context, decision)
  return ranked[0]
}
