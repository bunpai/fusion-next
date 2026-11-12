import { afterEach, describe, expect, it } from 'vitest'
import { SqliteFusionStore } from '../src/task/sqlite-store.js'
import { readSessionPair, syncSessionPairLead, writeSessionPair } from '../src/host/session-pair.js'

const stores: SqliteFusionStore[] = []
const store = () => { const next = new SqliteFusionStore(':memory:'); stores.push(next); return next }
afterEach(() => { while (stores.length) stores.pop()!.close() })

const lead = { provider: 'cpa', model: 'devin/swe-2' }
const worker = { provider: 'cpa', model: 'devin/swe-2-flash' }

describe('session pair document', () => {
  it('starts empty and round-trips lead/worker with revision CAS', () => {
    const db = store()
    expect(readSessionPair(db, 'session-1')).toBeUndefined()
    writeSessionPair(db, 'session-1', 0, { schemaVersion: 1, worker })
    const first = readSessionPair(db, 'session-1')!
    expect(first.revision).toBe(1)
    expect(first.pair.worker).toEqual(worker)
    expect(first.pair.lead).toBeUndefined()
    writeSessionPair(db, 'session-1', first.revision, { schemaVersion: 1, worker, lead })
    const second = readSessionPair(db, 'session-1')!
    expect(second.revision).toBe(2)
    expect(second.pair.lead).toEqual(lead)
    expect(second.pair.worker).toEqual(worker)
    expect(() => writeSessionPair(db, 'session-1', 0, { schemaVersion: 1 })).toThrow()
  })

  it('syncSessionPairLead preserves the worker and is idempotent', () => {
    const db = store()
    writeSessionPair(db, 'session-1', 0, { schemaVersion: 1, worker })
    syncSessionPairLead(db, 'session-1', lead)
    const synced = readSessionPair(db, 'session-1')!
    expect(synced.pair.worker).toEqual(worker)
    expect(synced.pair.lead).toEqual(lead)
    const revision = synced.revision
    syncSessionPairLead(db, 'session-1', lead)
    expect(readSessionPair(db, 'session-1')!.revision).toBe(revision)
    syncSessionPairLead(db, 'session-1', { provider: 'cpa', model: 'gemini-4-argon-high' })
    const switched = readSessionPair(db, 'session-1')!
    expect(switched.pair.lead?.model).toBe('gemini-4-argon-high')
    expect(switched.pair.worker).toEqual(worker)
  })

  it('keeps pairs isolated per session', () => {
    const db = store()
    writeSessionPair(db, 'session-a', 0, { schemaVersion: 1, worker })
    writeSessionPair(db, 'session-b', 0, { schemaVersion: 1 })
    expect(readSessionPair(db, 'session-a')!.pair.worker).toEqual(worker)
    expect(readSessionPair(db, 'session-b')!.pair.worker).toBeUndefined()
  })
})
