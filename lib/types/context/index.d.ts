export type ContextLayerCode = 'L0' | 'L1' | 'L2' | 'L3';
/** L0 = goal/constraints (mandatory), L1 = task briefs (mandatory), L2 = working evidence
 * (summaries), L3 = raw history (first dropped). Plan §10 L0–L3. */
export declare const LAYER_ORDER: readonly ContextLayerCode[];
export interface ContextItem {
    layer: ContextLayerCode;
    id: string;
    tokens: number;
    digest: string;
    content: string;
}
export interface ContextBudget {
    contextWindow: number;
    layerCaps: Record<ContextLayerCode, number>;
    reservedOutput: number;
}
/** Deterministic budget plan: reserve output headroom, then split the usable window across
 * layers with fixed ratios (L0 10%, L1 20%, L2 35%, L3 35%). Pure and stable so the same
 * window always yields the same plan (determinism requirement, plan G01). */
export declare function planBudget(contextWindow: number): ContextBudget;
export interface PackResult {
    packed: ContextItem[];
    dropped: ContextItem[];
    tokens: number;
}
/** Deterministic pack. Mandatory layers first: L0/L1 items are always taken while the total
 * usable cap allows (their fixed-ratio layer caps are planning guides, never a reason to lose
 * the goal or the brief). Droppable layers L2/L3 follow in (layer, id) order under both their
 * layer cap and the total cap. Deterministic for any input order. */
export declare function pack(items: readonly ContextItem[], budget: ContextBudget): PackResult;
export interface ContextCheckpoint {
    checkpointId: string;
    runId: string;
    generationId: string;
    epoch: number;
    items: ContextItem[];
    totalTokens: number;
    layerTokens: Record<ContextLayerCode, number>;
    digest: string;
}
export declare function makeCheckpoint(runId: string, generationId: string, epoch: number, items: readonly ContextItem[]): ContextCheckpoint;
export declare function verifyCheckpoint(checkpoint: ContextCheckpoint): boolean;
/** Transfer across model windows: repack the checkpoint into the target window, shedding L3
 * first, then L2; L0/L1 are always kept. If even the mandatory layers cannot fit the transfer
 * fails loudly (TRANSFER_INFEASIBLE) — never a silent truncation (plan §10 restart recovery). */
export declare function repackForTransfer(checkpoint: ContextCheckpoint, targetWindow: number): ContextCheckpoint;
export interface SummaryRecord {
    id: string;
    content: string;
    digest: string;
}
export declare function makeSummary(id: string, content: string): SummaryRecord;
export declare function verifySummary(summary: SummaryRecord): boolean;
