import { describe, expect, it } from 'vitest'
import { CatalogTripwire, tripwireBreached, type TripwireAudit } from '../src/host/tripwire.js'
import type { WorkspaceSnapshot } from '../src/host/workspace.js'

const snap = (id: string): WorkspaceSnapshot => ({ id, root: '/w', entries: [] } as unknown as WorkspaceSnapshot)
const audit = (over: Partial<TripwireAudit['staticAudits']>, changed = ['a.ts']): TripwireAudit => ({
  changedFiles: changed,
  staticAudits: {
    mutatedExistingTestFiles: [],
    deletedTestLines: 0,
    missingPromptLiterals: [],
    ...over,
  },
})

const make = (auditResult?: TripwireAudit) => {
  let calls = 0
  const wire = new CatalogTripwire({
    snapshot: root => (calls++, snap(root)),
    audit: async () => auditResult ?? audit({}),
  })
  return { wire, getCalls: () => calls }
}

describe('catalog tripwire (M5 C2)', () => {
  it('latches once per forward and ignores repeated requests in the same turn', async () => {
    const { wire, getCalls } = make()
    wire.latch('s', '/w', 'look at the repo')
    wire.latch('s', '/w', 'look at the repo')
    expect(getCalls()).toBe(1)
    await wire.settle('s')
    // settle consumed pending; a new turn latches again
    wire.latch('s', '/w', 'again')
    expect(getCalls()).toBe(3)
  })

  it('clean forwarded turn (no changes or clean diff) escalates nothing', async () => {
    const clean = make(audit({}, []))
    clean.wire.latch('s', '/w', 'check')
    expect(await clean.wire.settle('s')).toBeUndefined()
    expect(clean.wire.escalate('s')).toBe(false)
    const honest = make(audit({}))
    honest.wire.latch('s', '/w', 'check')
    expect(await honest.wire.settle('s')).toBeUndefined()
    expect(honest.wire.escalate('s')).toBe(false)
  })

  it('deleted test lines breach → escalation notice routed once', async () => {
    const { wire } = make(audit({ deletedTestLines: 12 }))
    wire.latch('s', '/w', 'summarise')
    const notice = await wire.settle('s')
    expect(notice).toContain('tripwire')
    expect(notice).toContain('deletedTestLines')
    expect(wire.escalate('s')).toBe(true)
    expect(wire.takeNotice('s')).toBe(notice)
    expect(wire.takeNotice('s')).toBeUndefined() // pops once
    expect(wire.escalate('s')).toBe(false)
  })

  it('missing prompt literals breach escalates too', async () => {
    const { wire } = make(audit({ missingPromptLiterals: ['report.md'] }))
    wire.latch('s', '/w', 'list files')
    expect(await wire.settle('s')).toContain('missingPromptLiterals')
    expect(wire.escalate('s')).toBe(true)
  })

  it('latch is skipped while a notice is still pending', () => {
    const { wire, getCalls } = make()
    wire.latch('s', '/w', 'x')
    // simulate a queued notice
    ;(wire as unknown as { notices: Map<string, string> }).notices.set('s', 'n')
    wire.latch('s', '/w', 'x')
    expect(getCalls()).toBe(1)
  })

  it('settle without a pending forward is a no-op', async () => {
    const { wire } = make()
    expect(await wire.settle('nope')).toBeUndefined()
  })

  it('clear drops both pending and notice', async () => {
    const { wire } = make(audit({ deletedTestLines: 1 }))
    wire.latch('s', '/w', 'x')
    await wire.settle('s')
    expect(wire.escalate('s')).toBe(true)
    wire.clear('s')
    expect(wire.escalate('s')).toBe(false)
    expect(wire.takeNotice('s')).toBeUndefined()
  })

  it('audit failure settles without escalating', async () => {
    const wire = new CatalogTripwire({
      snapshot: root => snap(root),
      audit: async () => { throw new Error('io') },
    })
    wire.latch('s', '/w', 'x')
    expect(await wire.settle('s')).toBeUndefined()
    expect(wire.escalate('s')).toBe(false)
  })

  it('tripwireBreached flags only the deterministic conditions', () => {
    expect(tripwireBreached(audit({}))).toBe(false)
    expect(tripwireBreached(audit({ mutatedExistingTestFiles: ['t.test.ts'] }))).toBe(false)
    expect(tripwireBreached(audit({ deletedTestLines: 1 }))).toBe(true)
    expect(tripwireBreached(audit({ missingPromptLiterals: ['x'] }))).toBe(true)
  })
})
