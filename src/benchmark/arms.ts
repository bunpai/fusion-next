/**
 * Benchmark arm driver (plan §15): metrics aggregation over executor results.
 *
 * The driver itself is pure and deterministic: executors are injected, so every
 * arm is testable without network. Three arms are planned:
 *   - 'strong-direct'   a strong model acting directly (runs anywhere, incl. in-host)
 *   - 'fusion-fixed'    the installed dsh-model-fusion@0.2.11 inside the real Host
 *   - 'fusion-next'     this repository's plugin inside the real Host
 * Only arms executed inside the real Host produce publishable numbers; anything
 * produced elsewhere must be reported as UNVERIFIED (plan §15 zero-tolerance).
 */
export type BenchmarkArm = 'strong-direct' | 'fusion-fixed' | 'fusion-next'
export type BenchmarkStatus = 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'UNVERIFIED'

export interface BenchmarkTask {
  taskId: string
  prompt: string
  acceptance: string
}

export interface ArmObservation {
  arm: BenchmarkArm
  taskId: string
  status: BenchmarkStatus
  latencyMs?: number
  costMicros?: number
  notes?: string
}

export interface ArmMetrics {
  arm: BenchmarkArm
  tasks: number
  successRate: number
  failureRate: number
  cancelledRate: number
  unverifiedRate: number
  p50LatencyMs: number | null
  p95LatencyMs: number | null
  meanCostMicros: number | null
}

export interface DirectExecutor {
  execute(task: BenchmarkTask): Promise<Omit<ArmObservation, 'arm' | 'taskId'>>
}

export function aggregate(arm: BenchmarkArm, observations: ArmObservation[]): ArmMetrics {
  const relevant = observations.filter((entry) => entry.arm === arm)
  const total = relevant.length
  const count = (status: BenchmarkStatus) => relevant.filter((entry) => entry.status === status).length
  const latencies = relevant
    .map((entry) => entry.latencyMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b)
  const costs = relevant
    .map((entry) => entry.costMicros)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const percentile = (fraction: number): number | null => {
    if (latencies.length === 0) return null
    const index = Math.min(latencies.length - 1, Math.max(0, Math.ceil(fraction * latencies.length) - 1))
    return latencies[index]
  }
  return {
    arm,
    tasks: total,
    successRate: total === 0 ? 0 : count('SUCCESS') / total,
    failureRate: total === 0 ? 0 : count('FAILED') / total,
    cancelledRate: total === 0 ? 0 : count('CANCELLED') / total,
    unverifiedRate: total === 0 ? 0 : count('UNVERIFIED') / total,
    p50LatencyMs: percentile(0.5),
    p95LatencyMs: percentile(0.95),
    meanCostMicros: costs.length === 0 ? null : costs.reduce((sum, value) => sum + value, 0) / costs.length,
  }
}

export async function runArm(arm: BenchmarkArm, tasks: BenchmarkTask[], executor: DirectExecutor): Promise<ArmObservation[]> {
  const observations: ArmObservation[] = []
  for (const task of tasks) {
    try {
      const outcome = await executor.execute(task)
      observations.push({ arm, taskId: task.taskId, ...outcome })
    } catch (error) {
      observations.push({
        arm, taskId: task.taskId, status: 'FAILED',
        notes: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      })
    }
  }
  return observations
}
