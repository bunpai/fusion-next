/** C01 minimal session lifecycle: capability-gated activation over the B03 journal. */
import { type HostCapabilityReport } from '../host-capabilities/index.js';
import { type FusionRunId } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
import { type AliasIntent } from './session-alias.js';
export interface ActivationOutcome {
    readonly runId: FusionRunId;
    readonly created: boolean;
    readonly resumed: boolean;
    readonly alreadyActive: boolean;
}
/**
 * Activation is gated twice: session.inspect validates the report itself and
 * lifecycle.transition authorizes every state change before any mutation. rc2
 * and unknown Host versions are denied by the A04 fence, so activate() fails
 * closed without touching the journal. Creation and activation are two journal
 * events, each its own durable transaction: a crash between them leaves the run
 * durably ACTIVATING, and the next activate() resumes it idempotently. Event ids
 * are derived from the run id plus the per-run revision observed at read time,
 * so an exact retry collapses into the already-committed event while any other
 * interleaving fails the CAS instead of double-applying.
 */
export declare class SessionLifecycle {
    private readonly manager;
    private readonly report;
    constructor(manager: RunManager, report: HostCapabilityReport);
    activate(hostSessionId: string, intent: AliasIntent): ActivationOutcome;
    private append;
    private activated;
    private restoreRequested;
    private restored;
}
