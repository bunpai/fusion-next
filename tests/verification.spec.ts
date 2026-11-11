import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { migrateFusionV2, openFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId, AgentGenerationId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { probeHostCapabilities, type HostCapabilityInput } from '../src/host-capabilities/index.js'
import { GenerationService, RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { IndependentVerifier } from '../src/verification/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-i01-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const route: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }
const observedAllTrue: HostCapabilityInput['observed'] = {
  sessionRead: true, sessionFork: true, forkLineage: true, sessionRebind: true, rebindAtomic: true,
  lifecycleEvents: true, lifecycleOrdering: true, approvalRequest: true, approvalTurnOpen: true,
  compactionControl: true, compactionTransaction: true, effectObservation: true,
  effectOutcomeKnown: true, effectIdempotency: true,
}
const rc5 = () => probeHostCapabilities({ sdkVersion: '0.2.1-rc.5', observed: observedAllTrue })
const capability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-a' }
const digest = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex')

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>

function seeded(): { file: string; manager: RunManager; verifier: IndependentVerifier } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  const registry = new RouteCapabilityRegistry()
  registry.declare('alpha', 'a1', capability)
  const generations = new GenerationService(manager, rc5(), registry)
  generations.prepare(run, 'agent-worker', 'native-worker', AgentGenerationId('g-producer'), route, {})
  generations.activate(run, AgentGenerationId('g-producer'))
  generations.prepare(run, 'agent-verifier', 'native-verifier', AgentGenerationId('g-verifier'), route, {})
  generations.activate(run, AgentGenerationId('g-verifier'))
  return { file, manager, verifier: new IndependentVerifier(manager, rc5()) }
}

describe('I01 independent verifier: E0–E3 evidence and verdicts where NOT_VERIFIED never passes', () => {
  it('verifies E2 evidence by recomputing the artifact digest independently', () => {
    const world = seeded()
    const { manager, verifier } = world
    try {
      verifier.recordEvidence(run, { evidenceId: 'ev-1', requirementId: 'req-build', level: 'E2',
        source: 'UNIT_TEST', command: 'pnpm test', exitCode: 0, artifactDigest: digest('all green'),
        producerGenerationId: 'g-producer' })
      const verdict = verifier.verify(run, 'req-build', 'ev-1', AgentGenerationId('g-verifier'), { artifactContent: 'all green' })
      expect(verdict.verdict).toBe('VERIFIED')
      expect(verifier.requirement('req-build').verdict).toBe('VERIFIED')
      verifier.requireVerified(run, 'req-build')
      void manager
    } finally { manager.close() }
  })

  it('fails verification on a digest mismatch and NOT_VERIFIED can never pass', () => {
    const world = seeded()
    const { manager, verifier } = world
    try {
      verifier.recordEvidence(run, { evidenceId: 'ev-1', requirementId: 'req-build', level: 'E2',
        source: 'UNIT_TEST', command: 'pnpm test', exitCode: 0, artifactDigest: digest('all green'),
        producerGenerationId: 'g-producer' })
      expect(verifier.verify(run, 'req-build', 'ev-1', AgentGenerationId('g-verifier'), { artifactContent: 'tampered' }).verdict)
        .toBe('FAILED_VERIFICATION')
      expect(verifier.requirement('req-build').verdict).toBe('FAILED_VERIFICATION')
      expect(() => verifier.requireVerified(run, 'req-build')).toThrow(/VERIFICATION_REQUIRED/)
      // No evidence at all.
      expect(verifier.verify(run, 'req-empty', 'ev-none', AgentGenerationId('g-verifier'), {})).toMatchObject({ verdict: 'NOT_VERIFIED' })
      expect(() => verifier.requireVerified(run, 'req-empty')).toThrow(/VERIFICATION_REQUIRED/)
    } finally { manager.close() }
  })

  it('keeps E0/E1 evidence permanently NOT_VERIFIED regardless of supplied proof', () => {
    const world = seeded()
    const { manager, verifier } = world
    try {
      verifier.recordEvidence(run, { evidenceId: 'ev-e0', requirementId: 'req-e0', level: 'E0', source: 'HOST_RUN', producerGenerationId: 'g-producer' })
      verifier.recordEvidence(run, { evidenceId: 'ev-e1', requirementId: 'req-e1', level: 'E1',
        source: 'HOST_RUN', command: 'pnpm test', exitCode: 1, producerGenerationId: 'g-producer' })
      expect(verifier.verify(run, 'req-e0', 'ev-e0', AgentGenerationId('g-verifier'), { artifactContent: 'whatever' }).verdict).toBe('NOT_VERIFIED')
      expect(verifier.verify(run, 'req-e1', 'ev-e1', AgentGenerationId('g-verifier'), { artifactContent: 'whatever' }).verdict).toBe('NOT_VERIFIED')
      expect(() => verifier.requireVerified(run, 'req-e0')).toThrow(/VERIFICATION_REQUIRED/)
      expect(() => verifier.requireVerified(run, 'req-e1')).toThrow(/VERIFICATION_REQUIRED/)
    } finally { manager.close() }
  })

  it('rejects self-verification by the producing generation', () => {
    const world = seeded()
    const { manager, verifier } = world
    try {
      verifier.recordEvidence(run, { evidenceId: 'ev-1', requirementId: 'req-build', level: 'E2',
        source: 'UNIT_TEST', command: 'pnpm test', exitCode: 0, artifactDigest: digest('all green'),
        producerGenerationId: 'g-producer' })
      expect(() => verifier.verify(run, 'req-build', 'ev-1', AgentGenerationId('g-producer'), { artifactContent: 'all green' }))
        .toThrow(/verification must be independent/)
    } finally { manager.close() }
  })

  it('honours E3 attestation only when the attested digest matches, and restores after restart', () => {
    const world = seeded()
    const { manager, verifier, file } = world
    try {
      verifier.recordEvidence(run, { evidenceId: 'ev-e3', requirementId: 'req-e3', level: 'E3',
        source: 'TOOL_OUTPUT', artifactDigest: digest('attested body'), producerGenerationId: 'g-producer' })
      expect(verifier.verify(run, 'req-e3', 'ev-e3', AgentGenerationId('g-verifier'), { attestedDigest: digest('attested body') }).verdict).toBe('VERIFIED')
      manager.close()
      const reopened = openRunManager(file)
      try {
        const restored = new IndependentVerifier(reopened, rc5())
        expect(restored.requirement('req-e3').verdict).toBe('VERIFIED')
        restored.requireVerified(run, 'req-e3')
        const db = openFusionV2(file)
        const row = db.prepare('SELECT requirement_id, verdict FROM fusion_evidence WHERE evidence_id = ?').get('ev-e3') as { requirement_id: string; verdict: string }
        expect(row).toMatchObject({ requirement_id: 'req-e3', verdict: 'VERIFIED' })
        db.close()
      } finally { reopened.close() }
    } finally { void manager }
  })
})
