/**
 * A04 input-only gate. `observed` is supplied by a separately verified Host adapter;
 * these names describe requirements, NOT SDK method names or runtime detection.
 * This module never calls Host APIs, performs rebind, or certifies Host compatibility.
 */
export interface HostCapabilityInput {
    /** Exact externally identified Host SDK version; never inferred from npm peer ranges. */
    readonly sdkVersion?: string;
    /** Every flag must be explicitly verified by the caller; missing !== supported. */
    readonly observed: Readonly<Partial<Record<HostEvidence, boolean>>>;
    /**
     * Operator attestation for a Host version this gate does not list. Upgrades
     * the unknown track to 'operator-attested' (mutation-eligible) while every
     * claim stays caller-supplied and never host-certified. The rc.2 fence is
     * hard: a known-unverified Desktop runtime cannot be attested around.
     */
    readonly attested?: boolean;
}
export type HostEvidence = 'sessionRead' | 'sessionFork' | 'forkLineage' | 'sessionRebind' | 'rebindAtomic' | 'lifecycleEvents' | 'lifecycleOrdering' | 'approvalRequest' | 'approvalTurnOpen' | 'compactionControl' | 'compactionTransaction' | 'effectObservation' | 'effectOutcomeKnown' | 'effectIdempotency';
export type HostOperation = 'session.inspect' | 'session.fork' | 'session.rebind' | 'lifecycle.transition' | 'approval.enforce' | 'compaction.execute' | 'effects.observe' | 'effects.replay';
export interface HostAdmission {
    readonly allowed: boolean;
    readonly mode: 'full' | 'degraded' | 'denied';
    readonly missing: readonly HostEvidence[];
    readonly reason: string;
}
export interface HostCapabilityReport {
    readonly versionTrack: 'desktop-rc2' | 'sdk-rc5' | 'operator-attested' | 'unknown';
    readonly operations: Readonly<Record<HostOperation, HostAdmission>>;
    readonly warnings: readonly string[];
    /** This always remains simulated until a real Host integration independently verifies it. */
    readonly evidenceLevel: 'caller-supplied-not-host-certified';
}
/** Pure admission logic. rc2 and unattested unknown versions never authorize mutations. */
export declare function probeHostCapabilities(input: HostCapabilityInput): HostCapabilityReport;
/** Explicit refusal; callers must not interpret a denied operation as a successful no-op. */
export declare function requireHostOperation(report: HostCapabilityReport, operation: HostOperation): HostAdmission;
