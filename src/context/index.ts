import { createHash } from 'node:crypto'

export type ContextLayerCode = 'L0' | 'L1' | 'L2' | 'L3'

/** L0 = goal/constraints (mandatory), L1 = task briefs (mandatory), L2 = working evidence
 * (summaries), L3 = raw history (first dropped). Plan §10 L0–L3. */
export const LAYER_ORDER: readonly ContextLayerCode[] = ['L0', 'L1', 'L2', 'L3']

export interface ContextItem {
  layer: ContextLayerCode
  id: string
  tokens: number
  digest: string
  content: string
}

export interface ContextBudget {
  contextWindow: number
  layerCaps: Record<ContextLayerCode, number>
  reservedOutput: number
}

/** Deterministic budget plan: reserve output headroom, then split the usable window across
 * layers with fixed ratios (L0 10%, L1 20%, L2 35%, L3 35%). Pure and stable so the same
 * window always yields the same plan (determinism requirement, plan G01). */
export function planBudget(contextWindow: number): ContextBudget {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    throw new Error('CONTEXT_BUDGET_INVALID: context window must be a positive integer')
  }
  const reservedOutput = Math.floor(contextWindow * 0.2)
  const usable = contextWindow - reservedOutput
  const share = (ratio: number) => Math.floor(usable * ratio)
  return {
    contextWindow,
    layerCaps: { L0: share(0.1), L1: share(0.2), L2: share(0.35), L3: share(0.35) },
    reservedOutput,
  }
}

export interface PackResult {
  packed: ContextItem[]
  dropped: ContextItem[]
  tokens: number
}

/** Deterministic pack. Mandatory layers first: L0/L1 items are always taken while the total
 * usable cap allows (their fixed-ratio layer caps are planning guides, never a reason to lose
 * the goal or the brief). Droppable layers L2/L3 follow in (layer, id) order under both their
 * layer cap and the total cap. Deterministic for any input order. */
export function pack(items: readonly ContextItem[], budget: ContextBudget): PackResult {
  const ordered = [...items].sort((a, b) => {
    const layerDelta = LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer)
    return layerDelta !== 0 ? layerDelta : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const used: Record<ContextLayerCode, number> = { L0: 0, L1: 0, L2: 0, L3: 0 }
  const totalCap = budget.contextWindow - budget.reservedOutput
  const packed: ContextItem[] = []
  const dropped: ContextItem[] = []
  let tokens = 0
  for (const entry of ordered) {
    if (entry.layer === 'L0' || entry.layer === 'L1') {
      if (tokens + entry.tokens <= totalCap) {
        used[entry.layer] += entry.tokens
        tokens += entry.tokens
        packed.push(entry)
      } else {
        dropped.push(entry)
      }
      continue
    }
    const layerCap = budget.layerCaps[entry.layer]
    if (entry.tokens <= layerCap - used[entry.layer] && tokens + entry.tokens <= totalCap) {
      used[entry.layer] += entry.tokens
      tokens += entry.tokens
      packed.push(entry)
    } else {
      dropped.push(entry)
    }
  }
  return { packed, dropped, tokens }
}

const canonical = (value: unknown): string => JSON.stringify(sortKeys(value))
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, inner]) => [key, sortKeys(inner)]))
  }
  return value
}

const digestOf = (items: readonly ContextItem[]): string =>
  createHash('sha256').update(canonical(items.map(entry => [entry.layer, entry.id, entry.tokens, entry.digest])))
    .digest('hex')

export interface ContextCheckpoint {
  checkpointId: string
  runId: string
  generationId: string
  epoch: number
  items: ContextItem[]
  totalTokens: number
  layerTokens: Record<ContextLayerCode, number>
  digest: string
}

export function makeCheckpoint(runId: string, generationId: string, epoch: number,
  items: readonly ContextItem[]): ContextCheckpoint {
  const sorted = [...items].sort((a, b) => {
    const layerDelta = LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer)
    return layerDelta !== 0 ? layerDelta : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const layerTokens: Record<ContextLayerCode, number> = { L0: 0, L1: 0, L2: 0, L3: 0 }
  for (const entry of sorted) layerTokens[entry.layer] += entry.tokens
  const totalTokens = Object.values(layerTokens).reduce((sum, value) => sum + value, 0)
  return {
    checkpointId: `cp-${digestOf(sorted).slice(0, 12)}`,
    runId, generationId, epoch,
    items: sorted, totalTokens, layerTokens,
    digest: digestOf(sorted),
  }
}

export function verifyCheckpoint(checkpoint: ContextCheckpoint): boolean {
  if (digestOf(checkpoint.items) !== checkpoint.digest) {
    throw new Error('CHECKPOINT_DIGEST_MISMATCH: checkpoint content does not match its digest')
  }
  const layerTokens: Record<ContextLayerCode, number> = { L0: 0, L1: 0, L2: 0, L3: 0 }
  for (const entry of checkpoint.items) layerTokens[entry.layer] += entry.tokens
  const total = Object.values(layerTokens).reduce((sum, value) => sum + value, 0)
  if (total !== checkpoint.totalTokens) {
    throw new Error('CHECKPOINT_DIGEST_MISMATCH: checkpoint token totals do not match its items')
  }
  return true
}

/** Transfer across model windows: repack the checkpoint into the target window, shedding L3
 * first, then L2; L0/L1 are always kept. If even the mandatory layers cannot fit the transfer
 * fails loudly (TRANSFER_INFEASIBLE) — never a silent truncation (plan §10 restart recovery). */
export function repackForTransfer(checkpoint: ContextCheckpoint, targetWindow: number): ContextCheckpoint {
  const budget = planBudget(targetWindow)
  const result = pack(checkpoint.items, budget)
  const mandatoryMissing = result.packed.some(entry => entry.layer === 'L0') === false ||
    result.packed.some(entry => entry.layer === 'L1') === false
  if (mandatoryMissing) {
    throw new Error(`TRANSFER_INFEASIBLE: target window ${targetWindow} cannot hold the mandatory L0/L1 layers`)
  }
  const layerTokens: Record<ContextLayerCode, number> = { L0: 0, L1: 0, L2: 0, L3: 0 }
  for (const entry of result.packed) layerTokens[entry.layer] += entry.tokens
  const totalTokens = Object.values(layerTokens).reduce((sum, value) => sum + value, 0)
  return {
    ...checkpoint,
    items: result.packed, totalTokens, layerTokens,
    digest: digestOf(result.packed),
  }
}

export interface SummaryRecord {
  id: string
  content: string
  digest: string
}

export function makeSummary(id: string, content: string): SummaryRecord {
  return { id, content, digest: createHash('sha256').update(content).digest('hex') }
}

export function verifySummary(summary: SummaryRecord): boolean {
  if (createHash('sha256').update(summary.content).digest('hex') !== summary.digest) {
    throw new Error(`SUMMARY_DIGEST_MISMATCH: summary ${summary.id} content does not match its digest`)
  }
  return true
}
