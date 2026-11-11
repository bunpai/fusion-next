import { AgentGenerationId, FusionRunId, type EvidenceRecord, type RequirementRecord, type VerificationVerdict } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'
import { createHash } from 'node:crypto'

/** I01 independent verifier over the E0–E3 evidence ladder.
 *
 * E0 no evidence, E1 executed without usable output evidence, E2 output evidence exists,
 * E3 independently attested. A verdict of NOT_VERIFIED is a first-class outcome: it can never be
 * mapped to a pass, and requireVerified() fails closed. The verifying generation must differ from
 * the producing generation — self-verification is rejected. */

export type EvidenceLevel = 'E0' | 'E1' | 'E2' | 'E3'

export type EvidenceInput = {
  evidenceId: string; requirementId: string; level: EvidenceLevel; source: string
  command?: string; exitCode?: number; artifactDigest?: string; producerGenerationId: string
}

export type VerificationProof = { artifactContent?: string; attestedDigest?: string }

export type VerificationOutcome = { verdict: VerificationVerdict; evidenceId: string; reason?: string }

export const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

export class IndependentVerifier {
  constructor(private readonly manager: RunManager, private readonly capabilityReport: HostCapabilityReport) {}

  recordEvidence(runId: string, input: EvidenceInput): EvidenceRecord {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    this.append(runId, { schemaVersion: 1, eventId: `fusion/evidence/${input.evidenceId}/recorded`,
      type: 'EVIDENCE_RECORDED', runId: FusionRunId(runId), evidenceId: input.evidenceId,
      requirementId: input.requirementId, level: input.level, source: input.source,
      command: input.command, exitCode: input.exitCode, artifactDigest: input.artifactDigest,
      producerGenerationId: AgentGenerationId(input.producerGenerationId) } as RunEventInput)
    return this.evidence(input.evidenceId)
  }

  verify(runId: string, requirementId: string, evidenceId: string, verifierGenerationId: string, proof: VerificationProof): VerificationOutcome {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    const state = this.manager.getState()
    if (!state.requirements[requirementId] || !state.evidence[evidenceId]) {
      // No usable evidence at all: NOT_VERIFIED, never a pass. Nothing to journal yet.
      return { verdict: 'NOT_VERIFIED', evidenceId, reason: 'no evidence recorded for this requirement' }
    }
    const evidence = state.evidence[evidenceId]
    if (evidence.requirementId !== requirementId) throw new Error(`NEEDS_REPAIR: evidence ${evidenceId} does not belong to requirement ${requirementId}`)
    let verdict: VerificationVerdict
    let reason: string | undefined
    if (evidence.level === 'E0' || evidence.level === 'E1') {
      verdict = 'NOT_VERIFIED'
      reason = `evidence ${evidenceId} is level ${evidence.level} and can never pass`
    } else if (evidence.level === 'E2') {
      if (proof.artifactContent === undefined) throw new Error('NEEDS_REPAIR: E2 verification requires artifact content to recompute the digest')
      verdict = sha256(proof.artifactContent) === evidence.artifactDigest ? 'VERIFIED' : 'FAILED_VERIFICATION'
      if (verdict === 'FAILED_VERIFICATION') reason = 'recomputed artifact digest differs from recorded evidence'
    } else {
      if (proof.attestedDigest === undefined) throw new Error('NEEDS_REPAIR: E3 verification requires the attestation digest')
      verdict = proof.attestedDigest === evidence.artifactDigest ? 'VERIFIED' : 'FAILED_VERIFICATION'
      if (verdict === 'FAILED_VERIFICATION') reason = 'attestation digest differs from recorded evidence'
    }
    this.append(runId, { schemaVersion: 1, eventId: `fusion/verification/${requirementId}/${evidenceId}/r${this.currentRevision(runId)}`,
      type: 'VERIFICATION_RECORDED', runId: FusionRunId(runId), requirementId, evidenceId,
      verifierGenerationId: AgentGenerationId(verifierGenerationId), verdict } as RunEventInput)
    return { verdict, evidenceId, reason }
  }

  requirement(requirementId: string): RequirementRecord {
    const record = this.manager.getState().requirements[requirementId]
    if (!record) throw new Error(`NEEDS_REPAIR: requirement ${requirementId} unknown`)
    return record
  }

  evidence(evidenceId: string): EvidenceRecord {
    const record = this.manager.getState().evidence[evidenceId]
    if (!record) throw new Error(`NEEDS_REPAIR: evidence ${evidenceId} unknown`)
    return record
  }

  requireVerified(runId: string, requirementId: string): RequirementRecord {
    const record = this.manager.getState().requirements[requirementId]
    // Unknown requirements fail closed: they are not verified, never a pass.
    if (!record) throw new Error(`VERIFICATION_REQUIRED: requirement ${requirementId} has no record and cannot pass`)
    if (record.runId !== FusionRunId(runId)) throw new Error(`NEEDS_REPAIR: requirement ${requirementId} belongs to another run`)
    if (record.verdict !== 'VERIFIED') throw new Error(`VERIFICATION_REQUIRED: requirement ${requirementId} is ${record.verdict} and cannot pass`)
    return record
  }

  private currentRevision(runId: string): number {
    const current = this.manager.getRun(FusionRunId(runId))
    if (!current) throw new Error(`NEEDS_REPAIR: run ${runId} has no projection`)
    return current.revision
  }

  private append(runId: string, input: RunEventInput): void {
    this.manager.append(input, this.currentRevision(runId))
  }
}
