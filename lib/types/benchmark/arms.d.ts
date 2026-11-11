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
export type BenchmarkArm = 'strong-direct' | 'fusion-fixed' | 'fusion-next';
export type BenchmarkStatus = 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'UNVERIFIED';
export interface BenchmarkTask {
    taskId: string;
    prompt: string;
    acceptance: string;
}
export interface ArmObservation {
    arm: BenchmarkArm;
    taskId: string;
    status: BenchmarkStatus;
    latencyMs?: number;
    costMicros?: number;
    notes?: string;
}
export interface ArmMetrics {
    arm: BenchmarkArm;
    tasks: number;
    successRate: number;
    failureRate: number;
    cancelledRate: number;
    unverifiedRate: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    meanCostMicros: number | null;
}
export interface DirectExecutor {
    execute(task: BenchmarkTask): Promise<Omit<ArmObservation, 'arm' | 'taskId'>>;
}
export declare function aggregate(arm: BenchmarkArm, observations: ArmObservation[]): ArmMetrics;
export declare function runArm(arm: BenchmarkArm, tasks: BenchmarkTask[], executor: DirectExecutor): Promise<ArmObservation[]>;
