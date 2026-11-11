import { type AssignmentRecord } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
import { type HostCapabilityReport } from '../host-capabilities/index.js';
import type { AgentManager, BriefSpec } from './index.js';
import type { AuthorityService, AuthoritySpec } from '../authority/index.js';
export type RoleKind = 'EXPLORER' | 'CODER' | 'REVIEWER' | 'SHADOW_REVIEWER';
/** Role presets fix what a role may ever hold. E02 policy: no role can be staffed with more
 * authority than its preset, and read-only roles stay read-only regardless of who asks.
 * The presets are intentionally narrow; broader capability is a Lead decision expressed as a
 * role change, never as a per-task scope widening. */
export declare const ROLE_PRESETS: Record<RoleKind, Pick<AuthoritySpec, 'toolScope' | 'approvalRequired'> & {
    writable: boolean;
}>;
export type StaffSpec = {
    role: RoleKind;
    agentId: string;
    generationId: string;
    assignmentId: string;
    brief: BriefSpec;
    /** Optional additional write paths for CODER only; ignored (and rejected if present) for
     * read-only roles. Paths are prefix-fenced at enforcement time (assertWithinWriteScope). */
    writePaths?: string[];
    /** Optional additional tools; always rejected for every role (no privilege escalation). */
    extraTools?: string[];
};
export type ShadowReviewSpec = {
    reportId: string;
    generationId: string;
    coderAssignmentId: string;
    verdict: 'CLEAN' | 'RISK';
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    findings: string[];
};
export type EscalationOutcome = {
    escalated: boolean;
    briefRevision?: number;
};
/** E02 role staffing + adaptive briefs + shadow-review escalation.
 *
 * Composes E01 assignments with D04 authority: every staffed role receives an immutable
 * per-generation authority profile derived from its preset; re-staffing the same role for a new
 * generation re-issues the identical preset (D04 allows identical, forbids expansion); any
 * attempt to widen tools or add write paths to a read-only role is rejected BEFORE any event.
 * A Shadow Reviewer observes a coder assignment and can only escalate through the brief channel:
 * a RISK verdict appends a `risk:<severity>` constraint via an adaptive brief revision. */
export declare class RoleManager {
    private readonly manager;
    private readonly agents;
    private readonly authority;
    private readonly capabilityReport;
    constructor(manager: RunManager, agents: AgentManager, authority: AuthorityService, capabilityReport: HostCapabilityReport);
    staffRole(runId: string, spec: StaffSpec): AssignmentRecord;
    /** Write-path fence: the generation must hold fs.write AND the path must sit inside its
     * issued writePaths. Explorer/reviewer generations fail at the tool gate. */
    assertWithinWriteScope(generationId: string, path: string): void;
    /** Shadow review: records a read-only verdict as a report on the shadow's own assignment and,
     * for RISK verdicts, escalates by refining the coder's brief (append `risk:<severity>` constraint). */
    shadowReview(runId: string, spec: ShadowReviewSpec): EscalationOutcome;
    /** Adaptive brief: raise the revision, keep the original constraints and merge the refinement
     * in sorted order (nothing is ever dropped from a brief — plan G03 constraint-preservation). */
    adaptBrief(runId: string, assignmentId: string, spec: {
        objective: string;
        extraConstraints: string[];
    }): AssignmentRecord;
    get(assignmentId: string): AssignmentRecord | undefined;
    private shadowAssignmentId;
}
