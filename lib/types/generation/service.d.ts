/** D02 Session Generation service: capability-checked preparation and stale-callback fencing.
 * Model switching (plan §4/T08/T09/T14/T17) is expressed as generation transitions over the B03
 * journal: a candidate route must be DECLARED capable for the pending requirements before any
 * journal event is appended, switches commit atomically (old RETIRED + new ACTIVE in one event),
 * and a callback from a generation that is no longer current is fenced by the reducer so a late
 * result can never commit into a new generation. External EFFECT receipts are deliberately NOT
 * fenced by generation: evidence of an external side effect must always be recorded. */
import { type HostCapabilityReport } from '../host-capabilities/index.js';
import { AgentGenerationId, FusionRunId, type ModelRoute } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
export interface CapabilityRequirements {
    readonly requireTools?: boolean;
    readonly minContextTokens?: number;
    /** Exact digest the run's task brief was frozen against; checked against the DECLARED capability. */
    readonly capabilityDigest?: string;
}
export interface RouteCapability {
    readonly tools: boolean;
    readonly contextWindow: number;
    readonly capabilityDigest: string;
}
export declare class RouteCapabilityRegistry {
    private readonly declared;
    declare(provider: string, model: string, capability: RouteCapability): void;
    /** Non-throwing lookup used by the L01 legacy-menu mapping. */
    lookup(provider: string, model: string): RouteCapability | undefined;
    assertCapable(route: ModelRoute, required: CapabilityRequirements): void;
}
export declare class GenerationService {
    private readonly manager;
    private readonly report;
    private readonly registry;
    constructor(manager: RunManager, report: HostCapabilityReport, registry: RouteCapabilityRegistry);
    prepare(runId: FusionRunId, agentId: string, sessionId: string, generationId: AgentGenerationId, route: ModelRoute, requirements: CapabilityRequirements, options?: {
        beforeCommit?: () => void;
    }): {
        generationId: AgentGenerationId;
        epoch: number;
    };
    activate(runId: FusionRunId, generationId: AgentGenerationId): void;
    /** Start draining the current generation before a switch; the run stays RUNNING. */
    drain(runId: FusionRunId, generationId: AgentGenerationId): void;
    /** Abandon an uncommitted preparation (never current). */
    abortPreparation(runId: FusionRunId, generationId: AgentGenerationId): void;
    /** Resume the still-current generation after a drain was started but the switch was abandoned. */
    cancelDrain(runId: FusionRunId, generationId: AgentGenerationId): void;
    /** Atomic switch: drain current -> prepare replacement -> commit old+new in ONE journal event.
     * The switch event is the crash boundary: no intermediate state can persist with the old
     * generation already retired but the replacement not yet active. */
    switchGeneration(runId: FusionRunId, agentId: string, fromGenerationId: AgentGenerationId, to: {
        generationId: AgentGenerationId;
        sessionId: string;
        route: ModelRoute;
        requirements: CapabilityRequirements;
    }): {
        from: AgentGenerationId;
        to: AgentGenerationId;
    };
    /** Commit-only step of a transition: atomically retires the drained source and activates the
     * prepared replacement in ONE journal event. Used by the D03 transition manager so the commit
     * step can crash and resume independently of the drain/prepare steps. */
    commitSwitch(runId: FusionRunId, fromGenerationId: AgentGenerationId, toGenerationId: AgentGenerationId): void;
    /** Tool/token callback delivery for the CURRENT generation; stale callbacks are fenced below. */
    callback(runId: FusionRunId, generationId: AgentGenerationId): void;
    private nextEpoch;
    private requireRun;
    private append;
}
