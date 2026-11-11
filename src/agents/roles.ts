import { AgentGenerationId, FusionRunId, type AssignmentRecord, type GenerationAuthority } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'
import { requireHostOperation, type HostCapabilityReport } from '../host-capabilities/index.js'
import type { AgentManager, BriefSpec } from './index.js'
import type { AuthorityService, AuthoritySpec } from '../authority/index.js'

export type RoleKind = 'EXPLORER' | 'CODER' | 'REVIEWER' | 'SHADOW_REVIEWER'

/** Role presets fix what a role may ever hold. E02 policy: no role can be staffed with more
 * authority than its preset, and read-only roles stay read-only regardless of who asks.
 * The presets are intentionally narrow; broader capability is a Lead decision expressed as a
 * role change, never as a per-task scope widening. */
export const ROLE_PRESETS: Record<RoleKind, Pick<AuthoritySpec, 'toolScope' | 'approvalRequired'> & { writable: boolean }> = {
  EXPLORER: { toolScope: ['fs.read', 'search'], approvalRequired: [], writable: false },
  CODER: { toolScope: ['fs.read', 'fs.write', 'search', 'shell.run'], approvalRequired: ['shell.run'], writable: true },
  REVIEWER: { toolScope: ['fs.read', 'search'], approvalRequired: [], writable: false },
  SHADOW_REVIEWER: { toolScope: ['fs.read', 'search'], approvalRequired: [], writable: false },
}

export type StaffSpec = {
  role: RoleKind; agentId: string; generationId: string; assignmentId: string; brief: BriefSpec
  /** Optional additional write paths for CODER only; ignored (and rejected if present) for
   * read-only roles. Paths are prefix-fenced at enforcement time (assertWithinWriteScope). */
  writePaths?: string[]
  /** Optional additional tools; always rejected for every role (no privilege escalation). */
  extraTools?: string[]
}

export type ShadowReviewSpec = {
  reportId: string; generationId: string; coderAssignmentId: string
  verdict: 'CLEAN' | 'RISK'; severity: 'LOW' | 'MEDIUM' | 'HIGH'; findings: string[]
}

export type EscalationOutcome = { escalated: boolean; briefRevision?: number }

const isSortedUnique = (values: readonly string[]): boolean => {
  if (values.length === 0) return true
  for (let index = 0; index < values.length; index += 1) {
    if (values[index].length === 0 || values[index].includes('\u0000')) return false
    if (index > 0 && values[index - 1] >= values[index]) return false
  }
  return true
}

const mergeSorted = (base: readonly string[], extra: readonly string[]): string[] =>
  [...new Set([...base, ...extra])].sort()

/** E02 role staffing + adaptive briefs + shadow-review escalation.
 *
 * Composes E01 assignments with D04 authority: every staffed role receives an immutable
 * per-generation authority profile derived from its preset; re-staffing the same role for a new
 * generation re-issues the identical preset (D04 allows identical, forbids expansion); any
 * attempt to widen tools or add write paths to a read-only role is rejected BEFORE any event.
 * A Shadow Reviewer observes a coder assignment and can only escalate through the brief channel:
 * a RISK verdict appends a `risk:<severity>` constraint via an adaptive brief revision. */
export class RoleManager {
  constructor(
    private readonly manager: RunManager,
    private readonly agents: AgentManager,
    private readonly authority: AuthorityService,
    private readonly capabilityReport: HostCapabilityReport,
  ) {}

  staffRole(runId: string, spec: StaffSpec): AssignmentRecord {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    const preset = ROLE_PRESETS[spec.role]
    if (spec.extraTools && spec.extraTools.length > 0) {
      throw new Error(`ROLE_SCOPE_VIOLATION: role ${spec.role} cannot gain tools beyond its preset: +${[...spec.extraTools].sort().join(', +')}`)
    }
    const writePaths = [...(spec.writePaths ?? [])].sort()
    if (!preset.writable && writePaths.length > 0) {
      throw new Error(`ROLE_SCOPE_VIOLATION: role ${spec.role} is read-only and cannot take write paths: +${writePaths.join(', +')}`)
    }
    if (!isSortedUnique(writePaths)) throw new Error('ROLE_SCOPE_VIOLATION: invalid write paths')
    const authoritySpec: AuthoritySpec = {
      toolScope: [...preset.toolScope], writePaths,
      approvalRequired: [...preset.approvalRequired],
    }
    // D04 semantics: an existing profile for the SAME role must not expand; an identical
    // re-issue (fresh generation, same preset) is required and allowed.
    const existing: GenerationAuthority | undefined = this.manager.getState().authorities[spec.generationId]
    if (existing) {
      const expansion = this.authority.expansion(existing, authoritySpec)
      if (expansion.length > 0) {
        throw new Error(`ROLE_SCOPE_VIOLATION: role ${spec.role} cannot expand authority: ${expansion.join(', ')}`)
      }
    } else {
      this.authority.issue(FusionRunId(runId), AgentGenerationId(spec.generationId), authoritySpec)
    }
    return this.agents.assign(FusionRunId(runId), {
      assignmentId: spec.assignmentId, role: spec.role === 'SHADOW_REVIEWER' ? 'REVIEWER' : spec.role === 'EXPLORER' ? 'WORKER' : spec.role === 'CODER' ? 'WORKER' : 'REVIEWER',
      workerAgentId: spec.role === 'EXPLORER' || spec.role === 'CODER' ? spec.agentId : undefined,
      brief: spec.brief,
      writeScope: preset.writable ? writePaths : [],
    })
  }

  /** Write-path fence: the generation must hold fs.write AND the path must sit inside its
   * issued writePaths. Explorer/reviewer generations fail at the tool gate. */
  assertWithinWriteScope(generationId: string, path: string): void {
    const profile = this.manager.getState().authorities[generationId]
    if (!profile) {
      throw new Error(`AUTHORITY_DENIED: unknown generation ${generationId}`)
    }
    if (!profile.toolScope.includes('fs.write')) {
      throw new Error(`AUTHORITY_DENIED: tool fs.write is outside generation ${generationId} scope`)
    }
    if (!profile.writePaths.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) {
      throw new Error(`WRITE_PATH_DENIED: path ${path} is outside generation ${generationId} write paths`)
    }
  }

  /** Shadow review: records a read-only verdict as a report on the shadow's own assignment and,
   * for RISK verdicts, escalates by refining the coder's brief (append `risk:<severity>` constraint). */
  shadowReview(runId: string, spec: ShadowReviewSpec): EscalationOutcome {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    this.agents.report(FusionRunId(runId), {
      reportId: spec.reportId, assignmentId: this.shadowAssignmentId(spec),
      generationId: spec.generationId,
      summary: `shadow verdict ${spec.verdict} severity ${spec.severity}: ${spec.findings.join('; ')}`,
      status: spec.verdict === 'RISK' ? 'NEEDS_INPUT' : 'COMPLETED',
      artifacts: [],
    })
    if (spec.verdict !== 'RISK') return { escalated: false }
    const coder = this.agents.get(spec.coderAssignmentId)
    if (!coder) throw new Error(`NEEDS_REPAIR: coder assignment ${spec.coderAssignmentId} unknown`)
    const adapted = this.adaptBrief(runId, spec.coderAssignmentId, {
      objective: coder.objective,
      extraConstraints: spec.findings.map(finding => `risk:${spec.severity} ${finding}`),
    })
    return { escalated: true, briefRevision: adapted.briefRevision }
  }

  /** Adaptive brief: raise the revision, keep the original constraints and merge the refinement
   * in sorted order (nothing is ever dropped from a brief — plan G03 constraint-preservation). */
  adaptBrief(runId: string, assignmentId: string, spec: { objective: string; extraConstraints: string[] }): AssignmentRecord {
    requireHostOperation(this.capabilityReport, 'lifecycle.transition')
    const current = this.agents.get(assignmentId)
    if (!current) throw new Error(`NEEDS_REPAIR: assignment ${assignmentId} unknown`)
    const briefRevision = current.briefRevision + 1
    this.agents.reviseBrief(FusionRunId(runId), assignmentId, briefRevision, {
      objective: spec.objective,
      constraints: mergeSorted(current.constraints, spec.extraConstraints),
      contextRefs: [...current.contextRefs],
    })
    const updated = this.agents.get(assignmentId)
    if (!updated) throw new Error('NEEDS_REPAIR: assignment missing after revision')
    return updated
  }

  get(assignmentId: string): AssignmentRecord | undefined {
    return this.agents.get(assignmentId)
  }

  private shadowAssignmentId(spec: ShadowReviewSpec): string {
    const shadow = Object.values(this.manager.getState().assignments)
      .find(record => record.role === 'REVIEWER' && record.objective.startsWith('observe coder'))
    if (!shadow) {
      throw new Error(`NEEDS_REPAIR: shadow reviewer assignment for ${spec.coderAssignmentId} not staffed`)
    }
    return shadow.assignmentId
  }
}
