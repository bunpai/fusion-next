import { describe, expect, it } from 'vitest'
import { NativeEffects } from '../src/host/native-effects.js'
import { TaskId } from '../src/contracts.js'

// PTC regression: under PTC every tool call executes inside a tracked run_code
// dispatch whose own effect stays 'dispatch-started' for the whole call. The
// work-order gates must not count the containing dispatch (ancestor exclusion),
// and submit/finish gates must scope pending to the calling agent only —
// otherwise fusion_next_delegate deadlocks ("Settle the current writer") and
// fusion_next_submit_result deadlocks ("settle effects before submitting").
function fixture() {
  const taskId = TaskId('ptc-task')
  const documents = new Map<string, { revision: number; value: any }>()
  const store = {
    putArtifact: () => ({ id: 'arguments' }),
    writeDocument: (id: string, _revision: number, value: any) => {
      documents.set(id, { revision: (documents.get(id)?.revision ?? 0) + 1, value })
    },
    readDocument: (id: string) => documents.get(id),
    listDocumentIds: (prefix: string) => [...documents.keys()].filter(id => id.startsWith(prefix)),
  }
  const ctx = { get: () => undefined, on: () => () => {} }
  const effects = new NativeEffects(ctx as never, store as never, {
    owner: () => ({ binding: { taskId } as never, role: 'worker' }),
    track: () => false,
    failed: () => {},
    backgroundMaxMs: () => null,
  })
  const effect = (id: string, agentId: string, callId: string, state = 'dispatch-started') =>
    store.writeDocument(`native-effect:${taskId}:${id}`, 0, {
      schemaVersion: 1, taskId, agentId, role: agentId === 'lead' ? 'lead' : 'worker',
      callId, rootCallId: callId.split(':')[0], toolName: 'run_code', processId: process.pid,
      startedAt: new Date().toISOString(), state,
    })
  return { effects, taskId, effect }
}

describe('pendingFor — PTC ancestor + agent scoping', () => {
  it('excludes the ancestor run_code dispatch but counts sibling inner calls', () => {
    const f = fixture()
    f.effect('outer', 'lead', 'outer-call')
    f.effect('inner0', 'lead', 'outer-call:ptc:0')
    // The inner call's exec sees its ancestor 'outer-call' excluded, but the
    // sibling ':ptc:0' still counts (it is not an ancestor of ':ptc:1').
    const pending = f.effects.pendingFor(f.taskId, { callId: 'outer-call:ptc:1', rootCallId: 'outer-call' })
    expect(pending.map(({ record }) => record.callId)).toEqual(['outer-call:ptc:0'])
    // Without exec context every pending effect counts (strict pre-PTC behavior).
    expect(f.effects.pendingFor(f.taskId)).toHaveLength(2)
  })

  it('scopes pending to the calling agent so a worker can submit while the lead dispatches', () => {
    const f = fixture()
    f.effect('lead-dispatch', 'lead', 'lead-call')
    f.effect('worker-done', 'worker', 'worker-call', 'returned')
    // Lead's in-flight dispatch must not block the worker's submit gate.
    expect(f.effects.pendingFor(f.taskId, undefined, 'worker')).toHaveLength(0)
    expect(f.effects.pendingFor(f.taskId, undefined, 'lead')).toHaveLength(1)
    // Task-wide pending (delegate gate) still counts both roles.
    expect(f.effects.pendingFor(f.taskId)).toHaveLength(1)
  })

  it('outcome-unknown effects stay pending', () => {
    const f = fixture()
    f.effect('uncertain', 'lead', 'c1', 'outcome-unknown')
    expect(f.effects.pendingFor(f.taskId)).toHaveLength(1)
    expect(f.effects.pendingFor(f.taskId, { callId: 'c1', rootCallId: 'c1' })).toHaveLength(0)
  })
})
