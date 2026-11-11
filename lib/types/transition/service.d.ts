import type { RunManager } from '../run-manager/index.js';
import { FusionRunId, type AgentGenerationId, type TransitionMode } from '../lifecycle/index.js';
import { type HostCapabilityReport } from '../host-capabilities/index.js';
import { GenerationService, RouteCapabilityRegistry, type CapabilityRequirements } from '../generation/service.js';
import type { EffectLedger } from '../effects/ledger.js';
import type { AuthorityService, AuthoritySpec } from '../authority/index.js';
import type { ModelRoute } from '../lifecycle/index.js';
/** D03 transition manager.
 *
 * Orchestrates a model/agent generation switch as explicit, individually crash-safe steps:
 * VALIDATE (pure checks, no events) -> CHECKPOINT (durable intent marker) -> QUIESCE (drain the
 * effect ledger) -> PREPARE (drain old generation, prepare replacement) -> COMMIT (single atomic
 * switch event) with ROLLBACK and REPAIR as first-class outcomes.
 *
 * Every step is an appended lifecycle event, so a crash at ANY step leaves a journal that a fresh
 * process replays into exactly the completed prefix; re-calling request() resumes idempotently.
 * Capability failures reject BEFORE any event (the old run is untouched). Unsettled effects force
 * REPAIR_REQUIRED and are never auto-retried (plan §8/Q08). */
export type TransitionPhase = 'VALIDATED' | 'QUIESCED' | 'CHECKPOINTED' | 'PREPARED' | 'COMMITTED' | 'ROLLED_BACK';
export type TransitionRequestSpec = {
    transitionId: string;
    agentId: string;
    mode: TransitionMode;
    fromGenerationId: AgentGenerationId;
    to: {
        generationId: AgentGenerationId;
        sessionId: string;
        route: ModelRoute;
        requirements: CapabilityRequirements;
        authority?: AuthoritySpec;
    };
};
export type TransitionOptions = {
    crashAfter?: 'checkpoint' | 'prepare';
};
export type TransitionOutcome = {
    outcome: 'COMMITTED';
    runId: FusionRunId;
    toGenerationId: AgentGenerationId;
    phases: TransitionPhase[];
    resumed?: boolean;
} | {
    outcome: 'ROLLED_BACK';
    runId: FusionRunId;
    fromGenerationId: AgentGenerationId;
    reason: string;
    phases: TransitionPhase[];
} | {
    outcome: 'REJECTED';
    runId: FusionRunId;
    reason: string;
} | {
    outcome: 'REPAIR_REQUIRED';
    runId: FusionRunId;
    phases: TransitionPhase[];
    blockers: string[];
};
export declare class TransitionService {
    private readonly manager;
    private readonly report;
    private readonly generations;
    private readonly ledger;
    private readonly registry;
    private readonly authority?;
    constructor(manager: RunManager, report: HostCapabilityReport, generations: GenerationService, ledger: EffectLedger, registry: RouteCapabilityRegistry, authority?: AuthorityService | undefined);
    request(runId: FusionRunId, spec: TransitionRequestSpec, options?: TransitionOptions): TransitionOutcome;
    private rollback;
    private appendEvent;
}
