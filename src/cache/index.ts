import { AgentGenerationId, FusionRunId, type FusionRunId as FusionRunIdBrand } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'

export type CacheEntryInput = {
  savedCostMicros: number; keepaliveCostMicros: number; expireAt: number; policyVersion: string
}
export type KeepaliveTickInput = {
  tickCostMicros: number; idleSeconds: number; ttlSeconds: number
  savingsRatio: number; cachedTokens: number
}
export type CacheEntryView = {
  runId: string; generationId: string; cacheKey: string
  savedCostMicros: number; keepaliveCostMicros: number; expireAt: number
  policyVersion: string; active: boolean
}

const cacheKeyOf = (runId: string, generationId: string, cacheKey: string): string => `${runId}|${generationId}|${cacheKey}`

/** G03 cache ledger.
 *
 * F02's `keepaliveDecision` proposes whether a keepalive tick should be scheduled; this ledger
 * disposes with hard accounting (plan Q10): a tick is journaled only while the entry is unexpired
 * AND cumulative keepalive spend stays below the recorded savings. The moment a tick would push the
 * cumulative keepalive cost past the savings — or the entry expired — the ledger stops keepalive
 * automatically instead of paying for a losing entry. */
export class CachePolicyService {
  constructor(private readonly manager: RunManager) {}

  record(runId: string, generationId: string, cacheKey: string, input: CacheEntryInput): void {
    this.append(FusionRunId(runId), { schemaVersion: 1,
      eventId: `fusion/cache/${cacheKeyOf(runId, generationId, cacheKey)}/recorded`,
      type: 'CACHE_ENTRY_RECORDED', runId: FusionRunId(runId), generationId: AgentGenerationId(generationId),
      cacheKey, savedCostMicros: input.savedCostMicros, keepaliveCostMicros: input.keepaliveCostMicros,
      expireAt: input.expireAt, policyVersion: input.policyVersion } as RunEventInput)
  }

  keepaliveTick(runId: string, generationId: string, cacheKey: string, tick: KeepaliveTickInput): void {
    const entry = this.entry(runId, generationId, cacheKey)
    if (!entry) throw new Error(`CACHE_UNKNOWN: no cache entry ${cacheKey} for generation ${generationId}`)
    if (tick.idleSeconds >= tick.ttlSeconds) {
      this.stop(runId, generationId, cacheKey, 'cache entry expired')
      throw new Error(`CACHE_KEEPALIVE_STOPPED: cache entry ${cacheKey} expired before tick`)
    }
    if (entry.keepaliveCostMicros + tick.tickCostMicros > entry.savedCostMicros) {
      this.stop(runId, generationId, cacheKey, 'keepalive loses money')
      throw new Error(`CACHE_KEEPALIVE_STOPPED: keepalive loses money on ${cacheKey}: cost ${entry.keepaliveCostMicros + tick.tickCostMicros} would exceed savings ${entry.savedCostMicros}`)
    }
    this.append(FusionRunId(runId), { schemaVersion: 1,
      eventId: `fusion/cache/${cacheKeyOf(runId, generationId, cacheKey)}/tick-r${entry.keepaliveCostMicros}`,
      type: 'CACHE_KEEPALIVE_TICK', runId: FusionRunId(runId), generationId: AgentGenerationId(generationId),
      cacheKey, tickCostMicros: tick.tickCostMicros, savingsRatio: tick.savingsRatio,
      cachedTokens: tick.cachedTokens } as RunEventInput)
  }

  entry(runId: string, generationId: string, cacheKey: string): CacheEntryView | undefined {
    const record = this.manager.getState().caches[cacheKeyOf(runId, generationId, cacheKey)]
    if (!record) return undefined
    return { runId: record.runId, generationId: record.generationId, cacheKey: record.cacheKey,
      savedCostMicros: record.savedCostMicros, keepaliveCostMicros: record.keepaliveCostMicros,
      expireAt: record.expireAt, policyVersion: record.policyVersion, active: record.keepaliveActive }
  }

  private stop(runId: string, generationId: string, cacheKey: string, reason: string): void {
    this.append(FusionRunId(runId), { schemaVersion: 1,
      eventId: `fusion/cache/${cacheKeyOf(runId, generationId, cacheKey)}/stopped`,
      type: 'CACHE_KEEPALIVE_STOPPED', runId: FusionRunId(runId), generationId: AgentGenerationId(generationId),
      cacheKey, reason } as RunEventInput)
  }

  private append(runId: FusionRunIdBrand, input: RunEventInput): void {
    const current = this.manager.getRun(runId)
    if (!current) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    this.manager.append(input, current.revision)
  }
}
