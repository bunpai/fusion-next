import { AgentGenerationId, FusionRunId, type GenerationAuthority } from '../lifecycle/index.js'
import type { RunEventInput, RunManager } from '../run-manager/index.js'

export type AuthoritySpec = {
  toolScope: string[]; writePaths: string[]; approvalRequired: string[]
}

export interface ResumeContext {
  runId: string; runStatus: string; generationId?: string; epoch?: number; route?: unknown
  authority?: GenerationAuthority; unsettledEffects: string[]
}

const UNSETTLED: ReadonlySet<string> = new Set(['INTENT', 'EXECUTING', 'NEEDS_REPAIR'])

const sorted = (values: string[]): string[] => [...values].sort()
const safeInt = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`)
  return value
}

/**
 * Per-generation authority ledger. A generation's tool scope, writable paths and approval
 * requirements are bound once, are immutable, and are journaled as AUTHORITY_ISSUED events so a
 * restart (or any other consumer) re-derives the exact same profile from the event journal.
 */
export class AuthorityService {
  constructor(private readonly manager: RunManager) {}

  issue(runId: string, generationId: string, spec: AuthoritySpec): GenerationAuthority {
    const runIdBrand = FusionRunId(runId)
    const genId = AgentGenerationId(generationId)
    const state = this.manager.getState()
    const run = state.runs[runIdBrand]
    if (!run) throw new Error(`AUTHORITY_CONFLICT: run ${runId} is unknown`)
    if (state.authorities[genId]) throw new Error(`AUTHORITY_CONFLICT: authority already issued for generation ${generationId}`)
    for (const value of [spec.toolScope.length, spec.writePaths.length, spec.approvalRequired.length]) safeInt(value, 'authority scope length')
    this.manager.append({ schemaVersion: 1, eventId: `fusion/authority/${generationId}`, type: 'AUTHORITY_ISSUED',
      runId: runIdBrand, generationId: genId,
      toolScope: sorted(spec.toolScope), writePaths: sorted(spec.writePaths), approvalRequired: sorted(spec.approvalRequired) } as RunEventInput, run.revision)
    const profile = this.manager.getState().authorities[genId]
    if (!profile) throw new Error('AUTHORITY_LEDGER_CONFLICT: authority missing after append')
    return profile
  }

  authorityOf(generationId: string): GenerationAuthority | undefined {
    return this.manager.getState().authorities[AgentGenerationId(generationId)]
  }

  assertAuthorized(generationId: string, tool: string): void {
    const profile = this.authorityOf(generationId)
    if (!profile) throw new Error(`AUTHORITY_DENIED: unknown generation ${generationId}`)
    if (!profile.toolScope.includes(tool)) throw new Error(`AUTHORITY_DENIED: tool ${tool} is outside generation ${generationId} scope`)
  }

  /** Privilege deltas from an old profile to a proposed one. Empty baseline (fork-fresh agent
   *  with no prior profile) yields no expansion entries — an initial issuance is not an expansion. */
  expansion(from: GenerationAuthority | undefined, to: AuthoritySpec): string[] {
    const parts: string[] = []
    const fromTools = new Set(from?.toolScope ?? [])
    const fromPaths = new Set(from?.writePaths ?? [])
    const fromApprovals = new Set(from?.approvalRequired ?? [])
    for (const tool of to.toolScope) if (!fromTools.has(tool)) parts.push(`+${tool}`)
    for (const path of to.writePaths) if (!fromPaths.has(path)) parts.push(`+${path}`)
    for (const tool of fromApprovals) if (!to.approvalRequired.includes(tool)) parts.push(`approval requirement dropped: ${tool}`)
    return parts
  }

  /** The resumption packet a Worker/Lead/Reviewer needs to continue exactly where the previous
   *  generation stopped: current generation, its route/epoch, its bound authority and every
   *  effect that is still unsettled. Derived from the journal, never broader than it was. */
  resumeContext(runId: string, agentId: string): ResumeContext {
    const state = this.manager.getState()
    const run = state.runs[FusionRunId(runId)]
    if (!run) throw new Error(`NEEDS_REPAIR: run ${runId} is unknown`)
    const generationId = run.currentGenerationIds[agentId]
    const generation = generationId ? state.generations[generationId] : undefined
    const authority = generationId ? state.authorities[generationId] : undefined
    const unsettledEffects = Object.values(state.effects)
      .filter(effect => effect.runId === runId && UNSETTLED.has(effect.state))
      .map(effect => `${effect.effectId}:${effect.state}`)
      .sort()
    return { runId, runStatus: run.status, generationId, epoch: generation?.epoch, route: generation?.route, authority, unsettledEffects }
  }
}
