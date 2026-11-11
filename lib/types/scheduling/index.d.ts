import type { RunManager } from '../run-manager/index.js';
import type { AgentManager } from '../agents/index.js';
/** H01 scheduling: assignment DAG, file ownership and provider limits.
 *
 * Dependencies and file claims are journaled through the reducer, so crash/restart restores them
 * exactly (plan H03 prerequisite). The provider limiter is deliberately in-memory runtime state:
 * provider concurrency windows are ephemeral scheduling facts, not durable domain state. */
export declare class Scheduler {
    private readonly manager;
    private readonly agents;
    constructor(manager: RunManager, agents: AgentManager);
    declareDependency(runId: string, assignmentId: string, dependsOnId: string): void;
    claimFiles(runId: string, assignmentId: string, paths: string[]): void;
    /** Deterministic readiness: OPEN assignments whose dependencies are all COMPLETED, ordered by id. */
    readyAssignments(runId: string): string[];
    ownerOf(runId: string, filePath: string): string | undefined;
    dependenciesOf(assignmentId: string): readonly string[];
    private currentRevision;
    private append;
}
export type ProviderLimiterOptions = {
    maxConcurrentPerProvider: number;
    maxConcurrentTotal: number;
};
/** Ephemeral provider rate limiting. acquire() is a pure capacity check; release() frees the slot. */
export declare class ProviderLimiter {
    private readonly options;
    private readonly perProvider;
    private total;
    constructor(options: ProviderLimiterOptions);
    acquire(provider: string): boolean;
    release(provider: string): void;
    inFlight(): Record<string, number> & {
        total: number;
    };
}
