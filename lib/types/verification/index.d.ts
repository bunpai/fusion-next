import { type EvidenceRecord, type RequirementRecord, type VerificationVerdict } from '../lifecycle/index.js';
import type { RunManager } from '../run-manager/index.js';
import { type HostCapabilityReport } from '../host-capabilities/index.js';
/** I01 independent verifier over the E0–E3 evidence ladder.
 *
 * E0 no evidence, E1 executed without usable output evidence, E2 output evidence exists,
 * E3 independently attested. A verdict of NOT_VERIFIED is a first-class outcome: it can never be
 * mapped to a pass, and requireVerified() fails closed. The verifying generation must differ from
 * the producing generation — self-verification is rejected. */
export type EvidenceLevel = 'E0' | 'E1' | 'E2' | 'E3';
export type EvidenceInput = {
    evidenceId: string;
    requirementId: string;
    level: EvidenceLevel;
    source: string;
    command?: string;
    exitCode?: number;
    artifactDigest?: string;
    producerGenerationId: string;
};
export type VerificationProof = {
    artifactContent?: string;
    attestedDigest?: string;
};
export type VerificationOutcome = {
    verdict: VerificationVerdict;
    evidenceId: string;
    reason?: string;
};
export declare const sha256: (content: string) => string;
export declare class IndependentVerifier {
    private readonly manager;
    private readonly capabilityReport;
    constructor(manager: RunManager, capabilityReport: HostCapabilityReport);
    recordEvidence(runId: string, input: EvidenceInput): EvidenceRecord;
    verify(runId: string, requirementId: string, evidenceId: string, verifierGenerationId: string, proof: VerificationProof): VerificationOutcome;
    requirement(requirementId: string): RequirementRecord;
    evidence(evidenceId: string): EvidenceRecord;
    requireVerified(runId: string, requirementId: string): RequirementRecord;
    private currentRevision;
    private append;
}
