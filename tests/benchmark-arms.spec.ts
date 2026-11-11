import { describe, expect, it } from 'vitest'
import { aggregate, runArm, type ArmObservation, type BenchmarkTask } from '../src/benchmark/arms.js'
import type { DirectExecutor } from '../src/benchmark/arms.js'

const task = (id: string): BenchmarkTask => ({ taskId: id, prompt: 'do the thing', acceptance: 'thing done' })

describe('benchmark arm aggregation', () => {
  it('computes success and percentile metrics deterministically', () => {
    const observations: ArmObservation[] = [
      { arm: 'strong-direct', taskId: 't1', status: 'SUCCESS', latencyMs: 100, costMicros: 1000 },
      { arm: 'strong-direct', taskId: 't2', status: 'SUCCESS', latencyMs: 200, costMicros: 2000 },
      { arm: 'strong-direct', taskId: 't3', status: 'SUCCESS', latencyMs: 300, costMicros: 3000 },
      { arm: 'strong-direct', taskId: 't4', status: 'FAILED', latencyMs: 400, costMicros: 400 },
      { arm: 'strong-direct', taskId: 't5', status: 'CANCELLED' },
      { arm: 'strong-direct', taskId: 't6', status: 'UNVERIFIED', notes: 'no cost evidence' },
      { arm: 'fusion-fixed', taskId: 't7', status: 'SUCCESS', latencyMs: 999, costMicros: 9 },
    ]
    const metrics = aggregate('strong-direct', observations)
    expect(metrics.tasks).toBe(6)
    expect(metrics.successRate).toBeCloseTo(3 / 6)
    expect(metrics.failureRate).toBeCloseTo(1 / 6)
    expect(metrics.cancelledRate).toBeCloseTo(1 / 6)
    expect(metrics.unverifiedRate).toBeCloseTo(1 / 6)
    expect(metrics.p50LatencyMs).toBe(200)
    expect(metrics.p95LatencyMs).toBe(400)
    expect(metrics.meanCostMicros).toBeCloseTo(1600)
    // other-arm rows never leak into this arm's metrics
    expect(aggregate('fusion-fixed', observations).tasks).toBe(1)
  })

  it('returns zeroed metrics for an empty arm instead of NaN', () => {
    const metrics = aggregate('fusion-next', [])
    expect(metrics).toEqual({
      arm: 'fusion-next', tasks: 0, successRate: 0, failureRate: 0, cancelledRate: 0, unverifiedRate: 0,
      p50LatencyMs: null, p95LatencyMs: null, meanCostMicros: null,
    })
  })

  it('converts executor throws into FAILED observations without losing the error', async () => {
    const throwing: DirectExecutor = { execute: async () => { throw new Error('BENCHMARK_HTTP_429: provider cpa failed') } }
    const observations = await runArm('strong-direct', [task('t-crash')], throwing)
    expect(observations[0].status).toBe('FAILED')
    expect(observations[0].notes).toMatch(/BENCHMARK_HTTP_429/)
    const executor: DirectExecutor = { execute: async () => ({ status: 'SUCCESS', latencyMs: 42, costMicros: 7 }) }
    const ok = await runArm('strong-direct', [task('t-ok')], executor)
    expect(ok[0]).toMatchObject({ arm: 'strong-direct', taskId: 't-ok', status: 'SUCCESS', latencyMs: 42, costMicros: 7 })
  })
})
