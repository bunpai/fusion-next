import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { captureExploration } from '../src/host/native-exploration.js'
import { snapshotWorkspace } from '../src/host/workspace.js'
import { SqliteFusionStore } from '../src/task/sqlite-store.js'
import { reduceAll } from '../src/task/reducer.js'
import { OperationId, SessionId, WorkOrderId } from '../src/contracts.js'
import { CHILD, created, envelope, order, TASK } from './helpers.js'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fusion-parallel-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'a.ts'), 'export const a = 1\n')
  const store = new SqliteFusionStore(':memory:')
  cleanup.push(() => store.close())
  store.create(created())
  const snapshot = snapshotWorkspace(root)
  const explore = {
    ...order(),
    id: WorkOrderId('wo-parallel'),
    operationId: OperationId('op-parallel'),
    mode: 'explore' as const,
    revision: 2,
    baseSnapshot: snapshot.id,
    allowedPaths: [],
    acceptance: [],
  }
  const parallelChild = SessionId('fusion-parallel-1')
  const report = captureExploration(store, explore, snapshot, snapshot,
    { status: 'completed', summary: 'Found one file.', unresolved: [] },
    [{ path: 'a.ts', startLine: 1, endLine: 1 }])
  const primary = [
    created(),
    envelope('intent/chosen', 2, { intent: 'DELEGATE' }),
    envelope('work-order/prepared', 3, { order: order(), reservedChild: CHILD }),
  ]
  const parallelPrepared = envelope('work-order/prepared', 4,
    { order: explore, reservedChild: parallelChild, parallel: true })
  return { explore, parallelChild, report, primary, parallelPrepared }
}

describe('parallel explore lane (bounded)', () => {
  it('runs a read-only explore order beside a primary implement order and clears on report', () => {
    const { explore, parallelChild, report, primary, parallelPrepared } = fixture()
    const state = reduceAll([
      ...primary,
      parallelPrepared,
      envelope('child/accepted', 5, { operationId: explore.operationId, child: parallelChild, messageId: 'm2' }),
      envelope('child/claimed', 6, { operationId: explore.operationId, child: parallelChild }),
      envelope('exploration/recorded', 7, { report }),
    ])
    // Parallel slots cleared; the primary order and its child slots are untouched.
    expect(state.parallelExploration).toEqual(report)
    expect(state.parallelOrder).toBeUndefined()
    expect(state.parallelChild).toBeUndefined()
    expect(state.parallelAccepted).toBe(false)
    expect(state.currentWorkOrder?.operationId).toBe('op-1')
    expect(state.acceptedChild).toBeUndefined()
  })

  it('rejects a second parallel order while one is in flight', () => {
    const { explore, parallelChild, primary, parallelPrepared } = fixture()
    const second = { ...explore, id: WorkOrderId('wo-parallel-2'), operationId: OperationId('op-parallel-2') }
    expect(() => reduceAll([
      ...primary, parallelPrepared,
      envelope('work-order/prepared', 5, { order: second, reservedChild: parallelChild, parallel: true }),
    ])).toThrow('parallel exploration is already running')
  })

  it('rejects a non-explore order on the parallel lane', () => {
    const { explore, parallelChild, primary } = fixture()
    const implement = { ...explore, mode: 'implement' as const }
    expect(() => reduceAll([
      ...primary,
      envelope('work-order/prepared', 4, { order: implement, reservedChild: parallelChild, parallel: true }),
    ])).toThrow('parallel order must be read-only exploration')
  })

  it('rejects a parallel report that is not bound to the frozen order', () => {
    const { report, primary, parallelPrepared } = fixture()
    expect(() => reduceAll([
      ...primary, parallelPrepared,
      envelope('exploration/recorded', 5, { report: { ...report, revision: 1 } }),
    ])).toThrow('not bound to its frozen order')
  })

  it('a report bound to the primary order id never lands on the parallel slot', () => {
    const { report, primary, parallelPrepared } = fixture()
    const wrong = { ...report, workOrderId: order().id }
    // Primary order is implement — the report can only be routed to the
    // primary explore slot, which rejects implement orders.
    expect(() => reduceAll([
      ...primary, parallelPrepared,
      envelope('exploration/recorded', 5, { report: wrong }),
    ])).toThrow('Exploration requires the current read-only work order')
  })
})
