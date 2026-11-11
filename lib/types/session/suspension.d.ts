/** C02 safe Fusion<->ordinary model suspend/resume with visible abnormal state.
 * Suspending a Fusion run before switching the host session to an ordinary model is only allowed
 * from a quiescent state: no pending approvals, no active write leases, no unsettled effects
 * (D01 drain barrier). Blocked suspends are REPORTED, never forced; abnormal states stay visible
 * through view() so a GUI can render exactly why a switch is unsafe. */
import { type HostCapabilityReport } from '../host-capabilities/index.js';
import { SessionAliasId, type EffectRecord, type FusionRunId, type RunStatus } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
import type { EffectLedger } from '../effects/ledger.js';
import { SessionLifecycle, type ActivationOutcome } from './lifecycle.js';
export interface SuspendOutcome {
    readonly runId?: FusionRunId;
    readonly bound: boolean;
    readonly suspended: boolean;
    readonly alreadySuspended: boolean;
    readonly blockers: readonly string[];
}
export interface SessionStateView {
    readonly hostSessionId: SessionAliasId;
    readonly bound: boolean;
    readonly runId?: FusionRunId;
    readonly status?: RunStatus;
    readonly abnormal: boolean;
    readonly blockers: readonly string[];
}
export declare class SessionSuspension {
    private readonly manager;
    private readonly ledger;
    private readonly report;
    private readonly lifecycle;
    constructor(manager: RunManager, ledger: EffectLedger, report: HostCapabilityReport, lifecycle: SessionLifecycle);
    suspend(hostSessionId: SessionAliasId): SuspendOutcome;
    /** Resume delegates to the C01 activation path (restore intent) so gate + idempotency match.
     * The gate runs HERE as well: a denied report must never reach the delegated mutation. */
    resume(hostSessionId: SessionAliasId): ActivationOutcome;
    view(hostSessionId: SessionAliasId): SessionStateView;
}
export declare function collectBlockers(status: RunStatus, approvals: number, leases: number, effects: readonly EffectRecord[]): string[];
