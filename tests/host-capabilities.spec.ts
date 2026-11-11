import { describe, expect, it } from 'vitest';
import { probeHostCapabilities, requireHostOperation, type HostCapabilityInput } from '../src/host-capabilities/index.js';

const complete: HostCapabilityInput = {
  sdkVersion: '0.2.1-rc.5',
  observed: {
    sessionRead: true, sessionFork: true, forkLineage: true,
    sessionRebind: true, rebindAtomic: true,
    lifecycleEvents: true, lifecycleOrdering: true,
    approvalRequest: true, approvalTurnOpen: true,
    compactionControl: true, compactionTransaction: true,
    effectObservation: true, effectOutcomeKnown: true, effectIdempotency: true,
  },
};
function input(observed: Partial<HostCapabilityInput['observed']>, sdkVersion = '0.2.1-rc.5'): HostCapabilityInput {
  return { sdkVersion, observed };
}

describe('input-only Host capability admission (simulated; no Host runtime attestation)', () => {
  it('fails closed for an old Host with no observed API while allowing read-only degradation', () => {
    const result = probeHostCapabilities(input({}, '0.2.1-rc.2'));
    expect(result.versionTrack).toBe('desktop-rc2');
    expect(result.operations['session.inspect'].allowed).toBe(true);
    expect(result.operations['session.inspect'].mode).toBe('degraded');
    for (const op of ['session.fork', 'session.rebind', 'lifecycle.transition', 'approval.enforce', 'compaction.execute', 'effects.replay'] as const) {
      expect(result.operations[op].allowed).toBe(false);
      expect(() => requireHostOperation(result, op)).toThrow(/HOST_CAPABILITY_DENIED/);
    }
  });
  it('rejects false declarations with missing semantic guarantees instead of trusting the version', () => {
    const observed = { ...complete.observed, forkLineage: false, rebindAtomic: false, approvalTurnOpen: false, compactionTransaction: false, effectIdempotency: false };
    const result = probeHostCapabilities(input(observed));
    expect(result.operations['session.fork'].allowed).toBe(false);
    expect(result.operations['session.rebind'].allowed).toBe(false);
    expect(result.operations['approval.enforce'].allowed).toBe(false);
    expect(result.operations['compaction.execute'].allowed).toBe(false);
    expect(result.operations['effects.replay'].allowed).toBe(false);
    expect(result.operations['effects.observe'].allowed).toBe(true);
  });
  it('keeps rc2 and rc5 distinct even with identical reported features', () => {
    const rc2 = probeHostCapabilities({ ...complete, sdkVersion: '0.2.1-rc.2' });
    const rc5 = probeHostCapabilities(complete);
    expect(rc2.versionTrack).toBe('desktop-rc2');
    expect(rc5.versionTrack).toBe('sdk-rc5');
    for (const op of ['session.fork', 'session.rebind', 'lifecycle.transition', 'approval.enforce', 'compaction.execute', 'effects.replay'] as const) {
      expect(rc2.operations[op].allowed).toBe(false);
    }
    expect(rc5.operations['session.fork'].allowed).toBe(true);
    expect(rc2.warnings.join(' ')).toMatch(/rc\.2.*runtime/i);
    expect(rc5.warnings.join(' ')).toMatch(/rc\.5.*type/i);
  });
  it('rejects unknown, malformed, or unsupported versions for dangerous operations', () => {
    for (const version of [undefined, 'not-semver', '0.2.1-rc.6', '0.3.0']) {
      const result = probeHostCapabilities({ ...complete, sdkVersion: version });
      expect(result.versionTrack).toBe('unknown');
      expect(result.operations['session.rebind'].allowed).toBe(false);
      expect(result.operations['session.inspect'].allowed).toBe(true);
    }
  });
  it('does not let a negative API observation be overridden by an implied capability', () => {
    const result = probeHostCapabilities(input({ ...complete.observed, sessionFork: false, effectOutcomeKnown: false }));
    expect(result.operations['session.fork'].allowed).toBe(false);
    expect(result.operations['effects.replay'].allowed).toBe(false);
  });
  it('rejects unknown operations instead of assuming an absent report entry is allowed', () => {
    const report = probeHostCapabilities(complete);
    expect(() => requireHostOperation(report, 'tools.execute' as never)).toThrow(/HOST_CAPABILITY_DENIED.*unknown operation/i);
  });
  it('rejects caller-forged reports and mutation of granted admissions', () => {
    const forged = {
      ...probeHostCapabilities(complete),
      operations: { ...probeHostCapabilities(complete).operations, 'session.rebind': { allowed: true, mode: 'full', missing: [], reason: 'forged' } },
    };
    expect(() => requireHostOperation(forged as never, 'session.rebind')).toThrow(/HOST_CAPABILITY_DENIED.*untrusted report/i);
    const report = probeHostCapabilities(input({}, '0.2.1-rc.2'));
    expect(() => { (report.operations['session.rebind'] as { allowed: boolean }).allowed = true; }).toThrow();
    expect(() => requireHostOperation(report, 'session.rebind')).toThrow(/HOST_CAPABILITY_DENIED/);
  });
  it('allows explicitly observed abilities but never authorizes unknown effect replay', () => {
    const result = probeHostCapabilities(complete);
    expect(requireHostOperation(result, 'session.fork').mode).toBe('full');
    expect(requireHostOperation(result, 'lifecycle.transition').mode).toBe('full');
    expect(requireHostOperation(result, 'effects.replay').mode).toBe('full');
    expect(probeHostCapabilities(input({ ...complete.observed, effectOutcomeKnown: false })).operations['effects.replay'].allowed).toBe(false);
  });
  it('operator attestation upgrades an unlisted version, with the rc.2 fence left intact', () => {
    const attested = probeHostCapabilities({ sdkVersion: '0.2.2-rc.1', attested: true, observed: complete.observed });
    expect(attested.versionTrack).toBe('operator-attested');
    expect(attested.warnings.join(' ')).toMatch(/operator attestation/i);
    expect(requireHostOperation(attested, 'lifecycle.transition').mode).toBe('full');
    const unattested = probeHostCapabilities({ sdkVersion: '0.2.2-rc.1', observed: complete.observed });
    expect(unattested.versionTrack).toBe('unknown');
    expect(unattested.operations['lifecycle.transition'].allowed).toBe(false);
    // A known-unverified Desktop runtime cannot be attested around.
    const rc2Attested = probeHostCapabilities({ sdkVersion: '0.2.1-rc.2', attested: true, observed: complete.observed });
    expect(rc2Attested.versionTrack).toBe('desktop-rc2');
    expect(rc2Attested.operations['session.fork'].allowed).toBe(false);
    // Attestation without the required observations still denies with prerequisites listed.
    const thin = probeHostCapabilities({ attested: true, observed: {} });
    expect(thin.operations['lifecycle.transition'].allowed).toBe(false);
    expect(thin.operations['lifecycle.transition'].missing.length).toBeGreaterThan(0);
  });
});