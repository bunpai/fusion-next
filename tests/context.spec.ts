import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunEventInput, type RunManager } from '../src/run-manager/index.js'
import { AgentGenerationId, FusionRunId, SessionAliasId, type LifecycleEvent, type ModelRoute } from '../src/lifecycle/index.js'
import { makeCheckpoint, pack, planBudget, repackForTransfer, verifyCheckpoint, verifySummary, makeSummary, type ContextItem } from '../src/context/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-f01-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const run = FusionRunId('run-1')
const session = SessionAliasId('session-1')
const route: ModelRoute = { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' }

const event = (payload: Record<string, unknown>, eventId: string): Omit<LifecycleEvent, 'seq' | 'expectedRevision'> =>
  ({ schemaVersion: 1, eventId, ...payload }) as Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
const rev = (manager: RunManager) => {
  const current = manager.getRun(run)
  if (!current) throw new Error('test bug: run missing')
  return current.revision
}

const item = (layer: ContextItem['layer'], id: string, tokens: number): ContextItem =>
  ({ layer, id, tokens, digest: `d-${layer}-${id}`, content: `content ${layer} ${id}` })

function seeded(): { file: string; manager: RunManager } {
  const file = path()
  migrateFusionV2(file)
  const manager = openRunManager(file)
  manager.append(event({ type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' }, 'seed-created'), 0)
  manager.append(event({ type: 'RUN_ACTIVATED', runId: run, hostSessionId: session }, 'seed-activated'), 1)
  manager.append(event({ type: 'GENERATION_PREPARED', runId: run, generationId: 'g-1', agentId: 'agent-lead', sessionId: 'native-1', epoch: 1, route, requirements: {} }, 'seed-prepared'), 2)
  manager.append(event({ type: 'GENERATION_ACTIVATED', runId: run, generationId: 'g-1' }, 'seed-active-gen'), 3)
  return { file, manager }
}

describe('F01 layered context, context budget, checkpoint/transfer', () => {
  it('plans a deterministic budget whose layer caps fit inside the window with output reserved', () => {
    const budget = planBudget(200_000)
    const caps = Object.values(budget.layerCaps)
    expect(budget.layerCaps.L0).toBeGreaterThan(0)
    expect(caps.reduce((sum, cap) => sum + cap, 0) + budget.reservedOutput).toBeLessThanOrEqual(200_000)
    // Deterministic: same window → same plan.
    expect(planBudget(200_000)).toEqual(budget)
    const small = planBudget(32_000)
    expect(small.layerCaps.L0).toBeLessThanOrEqual(budget.layerCaps.L0)
  })

  it('packs deterministically under layer caps and drops L3 before L2 before upper layers', () => {
    const budget = planBudget(10_000)
    const items = [item('L3', 'h-1', 900), item('L3', 'h-2', 900), item('L2', 'e-1', 900),
      item('L1', 'b-1', 900), item('L0', 'g-1', 900)]
    const first = pack(items, budget)
    const second = pack([...items].reverse(), budget)
    expect(first.packed.map(entry => entry.id)).toEqual(second.packed.map(entry => entry.id))
    expect(first.tokens).toBeLessThanOrEqual(10_000 - budget.reservedOutput)
    expect(first.packed.some(entry => entry.layer === 'L0')).toBe(true)
  })

  it('commits checkpoints with a content digest, verifies them, and rejects tampering', () => {
    const checkpoint = makeCheckpoint(run, 'g-1', 1, [item('L0', 'g-1', 100), item('L2', 'e-1', 300)])
    expect(verifyCheckpoint(checkpoint)).toBe(true)
    const tampered = { ...checkpoint, items: [{ ...checkpoint.items[0], tokens: 999 }] }
    expect(() => verifyCheckpoint(tampered)).toThrow(/CHECKPOINT_DIGEST_MISMATCH/)
  })

  it('transfers a checkpoint to a smaller model window by dropping L3 then L2, never the brief or goal', () => {
    const items = [item('L0', 'goal', 500), item('L1', 'brief', 1500), item('L2', 'e-1', 4000), item('L3', 'h-1', 8000), item('L3', 'h-2', 8000)]
    const big = makeCheckpoint(run, 'g-1', 1, items)
    expect(big.totalTokens).toBe(22_000)
    const transferred = repackForTransfer(big, 32_000)
    expect(transferred.totalTokens).toBeLessThanOrEqual(32_000 - planBudget(32_000).reservedOutput)
    expect(transferred.items.some(entry => entry.layer === 'L0')).toBe(true)
    expect(transferred.items.some(entry => entry.layer === 'L1')).toBe(true)
    // The transfer keeps everything that fits; the overflow item is the one shed.
    expect(transferred.totalTokens).toBeLessThan(big.totalTokens)
    // Even smaller: L2 goes too, but L0/L1 remain mandatory.
    const tight = repackForTransfer(big, 6_000)
    expect(tight.items.map(entry => entry.layer)).toEqual(expect.arrayContaining(['L0', 'L1']))
    expect(tight.items.every(entry => entry.layer !== 'L2')).toBe(true)
    // Below the mandatory floor the transfer must fail loudly, never silently truncate.
    expect(() => repackForTransfer(big, 1_000)).toThrow(/TRANSFER_INFEASIBLE/)
  })

  it('verifies summaries and fails closed on a mismatched digest', () => {
    const summary = makeSummary('sum-1', 'the failing area is module X, root cause Y')
    expect(verifySummary(summary)).toBe(true)
    expect(() => verifySummary({ ...summary, content: 'the failing area is module Z' })).toThrow(/SUMMARY_DIGEST_MISMATCH/)
  })

  it('journals checkpoint references and restores them after restart; rejects a foreign generation', () => {
    const world = seeded()
    const { manager, file } = world
    try {
      const checkpoint = makeCheckpoint(run, 'g-1', 1, [item('L0', 'goal', 100)])
      manager.append({ schemaVersion: 1, eventId: 'fusion/checkpoint/cp-1', type: 'CONTEXT_CHECKPOINTED',
        runId: run, checkpointId: 'cp-1', generationId: AgentGenerationId('g-1'), epoch: 1,
        digest: checkpoint.digest, totalTokens: checkpoint.totalTokens,
        layerTokens: checkpoint.layerTokens } as RunEventInput, rev(manager))
      expect(manager.getState().checkpoints['cp-1']).toMatchObject({ generationId: 'g-1', epoch: 1 })
      manager.close()
      const reopened = openRunManager(file)
      try {
        expect(reopened.getState().checkpoints['cp-1']).toMatchObject({ digest: checkpoint.digest })
        expect(() => reopened.append({ schemaVersion: 1, eventId: 'fusion/checkpoint/cp-2', type: 'CONTEXT_CHECKPOINTED',
          runId: run, checkpointId: 'cp-2', generationId: AgentGenerationId('ghost'), epoch: 1,
          digest: 'd', totalTokens: 1, layerTokens: { L0: 1 } } as RunEventInput, rev(reopened)))
          .toThrow(/checkpoint generation mismatch|unknown generation/i)
      } finally { reopened.close() }
    } finally { void manager }
  })
})
