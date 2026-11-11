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
}

export type HostEvidence =
  | 'sessionRead' | 'sessionFork' | 'forkLineage'
  | 'sessionRebind' | 'rebindAtomic'
  | 'lifecycleEvents' | 'lifecycleOrdering'
  | 'approvalRequest' | 'approvalTurnOpen'
  | 'compactionControl' | 'compactionTransaction'
  | 'effectObservation' | 'effectOutcomeKnown' | 'effectIdempotency';

export type HostOperation =
  | 'session.inspect' | 'session.fork' | 'session.rebind'
  | 'lifecycle.transition' | 'approval.enforce'
  | 'compaction.execute' | 'effects.observe' | 'effects.replay';

export interface HostAdmission {
  readonly allowed: boolean;
  readonly mode: 'full' | 'degraded' | 'denied';
  readonly missing: readonly HostEvidence[];
  readonly reason: string;
}
export interface HostCapabilityReport {
  readonly versionTrack: 'desktop-rc2' | 'sdk-rc5' | 'unknown';
  readonly operations: Readonly<Record<HostOperation, HostAdmission>>;
  readonly warnings: readonly string[];
  /** This always remains simulated until a real Host integration independently verifies it. */
  readonly evidenceLevel: 'caller-supplied-not-host-certified';
}

/** Conservative requirements for state-changing operations (not asserted Host APIs). */
const REQUIRED: Readonly<Record<Exclude<HostOperation, 'session.inspect'>, readonly HostEvidence[]>> = {
  'session.fork': ['sessionFork', 'forkLineage'],
  'session.rebind': ['sessionRebind', 'rebindAtomic'],
  'lifecycle.transition': ['lifecycleEvents', 'lifecycleOrdering', 'sessionRebind', 'rebindAtomic'],
  'approval.enforce': ['approvalRequest', 'approvalTurnOpen'],
  'compaction.execute': ['compactionControl', 'compactionTransaction'],
  'effects.observe': ['effectObservation'],
  'effects.replay': ['effectObservation', 'effectOutcomeKnown', 'effectIdempotency'],
};

/** Pure admission logic. Unknown versions never authorize state mutations. */
export function probeHostCapabilities(input: HostCapabilityInput): HostCapabilityReport {
  const versionTrack: HostCapabilityReport['versionTrack'] = input.sdkVersion === '0.2.1-rc.2'
    ? 'desktop-rc2'
    : input.sdkVersion === '0.2.1-rc.5' ? 'sdk-rc5' : 'unknown';
  const warnings: string[] = versionTrack === 'desktop-rc2'
    ? ['rc.2 packaged Desktop runtime is unverified; no fork/rebind semantics are certified.']
    : versionTrack === 'sdk-rc5'
      ? ['rc.5 SDK type declarations are not proof of Host runtime behavior.']
      : ['Unknown/unsupported Host version: state mutations denied regardless of claimed features.'];
  const operations = {} as Record<HostOperation, HostAdmission>;
  operations['session.inspect'] = input.observed.sessionRead === true
    ? { allowed: true, mode: 'full', missing: [], reason: 'Read capability explicitly supplied.' }
    : { allowed: true, mode: 'degraded', missing: ['sessionRead'], reason: 'Metadata-only inspection; no Host session read or mutation.' };
  for (const [operation, required] of Object.entries(REQUIRED) as [Exclude<HostOperation, 'session.inspect'>, readonly HostEvidence[]][]) {
    const missing = required.filter((key) => input.observed[key] !== true);
    const allowed = missing.length === 0 && (versionTrack !== 'unknown' || operation === 'effects.observe');
    operations[operation] = {
      allowed,
      mode: allowed ? 'full' : 'denied',
      missing,
      reason: allowed ? 'All caller-supplied prerequisites satisfied; Host not certified.'
        : versionTrack === 'unknown' && operation !== 'effects.observe'
          ? `Unsupported Host SDK version: ${input.sdkVersion ?? '(not provided)'}.`
          : `Missing verified prerequisites: ${missing.join(', ')}.`,
    };
  }
  return { versionTrack, operations, warnings, evidenceLevel: 'caller-supplied-not-host-certified' };
}

/** Explicit refusal; callers must not interpret a denied operation as a successful no-op. */
export function requireHostOperation(report: HostCapabilityReport, operation: HostOperation): HostAdmission {
  const admission = report.operations[operation];
  if (!admission.allowed) throw new Error(`HOST_CAPABILITY_DENIED [${operation}]: ${admission.reason}`);
  return admission;
}
