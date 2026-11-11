import { type GenerationAuthority } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
export type AuthoritySpec = {
    toolScope: string[];
    writePaths: string[];
    approvalRequired: string[];
};
export interface ResumeContext {
    runId: string;
    runStatus: string;
    generationId?: string;
    epoch?: number;
    route?: unknown;
    authority?: GenerationAuthority;
    unsettledEffects: string[];
}
/**
 * Per-generation authority ledger. A generation's tool scope, writable paths and approval
 * requirements are bound once, are immutable, and are journaled as AUTHORITY_ISSUED events so a
 * restart (or any other consumer) re-derives the exact same profile from the event journal.
 */
export declare class AuthorityService {
    private readonly manager;
    constructor(manager: RunManager);
    issue(runId: string, generationId: string, spec: AuthoritySpec): GenerationAuthority;
    authorityOf(generationId: string): GenerationAuthority | undefined;
    assertAuthorized(generationId: string, tool: string): void;
    /** Privilege deltas from an old profile to a proposed one. Empty baseline (fork-fresh agent
     *  with no prior profile) yields no expansion entries — an initial issuance is not an expansion. */
    expansion(from: GenerationAuthority | undefined, to: AuthoritySpec): string[];
    /** The resumption packet a Worker/Lead/Reviewer needs to continue exactly where the previous
     *  generation stopped: current generation, its route/epoch, its bound authority and every
     *  effect that is still unsettled. Derived from the journal, never broader than it was. */
    resumeContext(runId: string, agentId: string): ResumeContext;
}
