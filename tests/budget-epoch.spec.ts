import { describe, expect, it } from 'vitest'
import { executionFailures, type DispatchRecord, type RuntimeV3 } from '../src/host/runtime-v3.js'

const rec = (status: DispatchRecord['status'], epoch?: number): DispatchRecord =>
  ({ id: 'd', instruction: 'x', startedAt: 't', status, epoch })
const rt = (...dispatches: DispatchRecord[]): RuntimeV3 =>
  ({ schemaVersion: 3, taskId: 't' as RuntimeV3['taskId'], createdAt: 't', updatedAt: 't', dispatches })

describe('executionFailures — epoch-scoped rework budget (f33 regression)', () => {
  it('counts only trailing consecutive failed records', () => {
    expect(executionFailures(rt(rec('failed'), rec('failed'), rec('failed')), 1)).toBe(3)
    expect(executionFailures(rt(rec('completed'), rec('failed')), 1)).toBe(1)
    expect(executionFailures(rt(rec('failed'), rec('completed')), 1)).toBe(0)
  })

  it('stalled/quarantined do NOT consume the rework budget', () => {
    // the f33 shape: three stalls each followed by a repair that completed —
    // must never exhaust the budget
    expect(executionFailures(rt(
      rec('stalled', 1), rec('completed', 1),
      rec('stalled', 1), rec('completed', 1),
      rec('stalled', 1),
    ), 1)).toBe(0)
    expect(executionFailures(rt(rec('quarantined')), 1)).toBe(0)
  })

  it('a failure from an older user-turn epoch does not count', () => {
    const runtime = rt(rec('failed', 1), rec('failed', 1), rec('failed', 1))
    expect(executionFailures(runtime, 2)).toBe(0)
    expect(executionFailures(runtime, 1)).toBe(3)
  })

  it('epoch boundary breaks the streak mid-run', () => {
    const runtime = rt(rec('failed', 1), rec('failed', 2), rec('failed', 2))
    expect(executionFailures(runtime, 2)).toBe(2)
  })

  it('rejected records are transparent — they neither count nor break the streak', () => {
    const runtime = rt(rec('failed', 1), rec('rejected', 1), rec('failed', 1))
    expect(executionFailures(runtime, 1)).toBe(2)
    // …but a leading rejected does not hide real failures either
    const locked = rt(rec('failed', 1), rec('failed', 1), rec('failed', 1), rec('rejected', 1))
    expect(executionFailures(locked, 1)).toBe(3)
  })

  it('records without an epoch count toward the current epoch (legacy docs)', () => {
    expect(executionFailures(rt(rec('failed'), rec('failed')), 7)).toBe(2)
  })

  it('interrupted/steered/infra/running break the streak', () => {
    for (const s of ['interrupted', 'steered', 'infra', 'running', 'completed', 'stalled', 'quarantined'] as const) {
      expect(executionFailures(rt(rec('failed', 1), rec(s, 1)), 1)).toBe(0)
    }
  })
})
