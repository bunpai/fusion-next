import type { RunManager } from '../run-manager/index.js'

/** J01 model score statistics over the journaled budget usage ledger (G02) and verifier verdicts.
 *
 * Scores are a pure projection of the journal — no new events. Failures and cancellations count
 * in the denominator. Small samples are never ranked: ranking uses the Wilson lower confidence
 * bound and requires a minimum sample count so tiny histories cannot overfit routing decisions. */

export type ScoreStats = {
  provider: string
  model: string
  attempts: number
  successes: number
  failures: number
  cancelled: number
  spentMicros: number
  successRate: number
  /** Wilson lower bound at 95% confidence — the honest pessimistic success estimate. */
  confidence: number
  /** False until attempts reaches minSamples; insufficient samples are excluded from ranking. */
  sampleSufficient: boolean
}

export type RankedRoute = ScoreStats & { rank: number }

const Z = 1.96

export function wilsonLowerBound(successes: number, attempts: number): number {
  if (attempts <= 0) return 0
  const p = successes / attempts
  const n = attempts
  const denominator = 1 + (Z * Z) / n
  const center = p + (Z * Z) / (2 * n)
  const spread = Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))
  return Math.max(0, (center - spread) / denominator)
}

const MIN_SAMPLES_DEFAULT = 5

export class ModelScoreService {
  constructor(private readonly manager: RunManager, private readonly minSamples: number = MIN_SAMPLES_DEFAULT) {}

  private collect(): Map<string, ScoreStats> {
    const state = this.manager.getState()
    const byKey = new Map<string, { provider: string; model: string; successes: number; failures: number; cancelled: number; spentMicros: number }>()
    for (const budget of Object.values(state.budgets)) {
      for (const entry of Object.values(budget.usage)) {
        const key = `${entry.route.provider}/${entry.route.model}`
        const record = byKey.get(key) ?? { provider: entry.route.provider, model: entry.route.model, successes: 0, failures: 0, cancelled: 0, spentMicros: 0 }
        if (entry.status === 'COMPLETED') {
          record.successes += 1
          record.spentMicros += entry.costMicros
        } else if (entry.status === 'FAILED') record.failures += 1
        else if (entry.status === 'CANCELLED') record.cancelled += 1
        byKey.set(key, record)
      }
    }
    const stats = new Map<string, ScoreStats>()
    for (const [key, record] of byKey) {
      const attempts = record.successes + record.failures + record.cancelled
      stats.set(key, { ...record, attempts,
        successRate: attempts > 0 ? record.successes / attempts : 0,
        confidence: wilsonLowerBound(record.successes, attempts),
        sampleSufficient: attempts >= this.minSamples })
    }
    return stats
  }

  scoreOf(provider: string, model: string): ScoreStats {
    const stats = this.collect().get(`${provider}/${model}`)
    if (!stats) {
      return { provider, model, attempts: 0, successes: 0, failures: 0, cancelled: 0, spentMicros: 0,
        successRate: 0, confidence: 0, sampleSufficient: false }
    }
    return stats
  }

  /** Only sample-sufficient routes are ranked, by Wilson lower bound then raw success rate. */
  rank(): RankedRoute[] {
    const ranked = [...this.collect().values()]
      .filter((stats) => stats.sampleSufficient)
      .sort((a, b) => b.confidence - a.confidence || b.successRate - a.successRate || `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`))
      .map((stats, index) => ({ ...stats, rank: index + 1 }))
    return ranked
  }
}
