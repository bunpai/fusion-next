import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { replayA02, type A02Scenario } from './fixtures/a02/replay.js'

const root = fileURLToPath(new URL('./fixtures/a02/', import.meta.url))
const cases = ['menu-enter-exit', 'history-activation', 'fork-activation', 'parallel-branches'] as const
function load(name: string): A02Scenario {
  return JSON.parse(readFileSync(join(root, `${name}.json`), 'utf8')) as A02Scenario
}

describe('A02 deterministic simulated Host event replay (NOT live Host evidence)', () => {
  for (const name of cases) {
    it(`${name}: matches ordered event checkpoints and invariants`, () => {
      const fixture = load(name)
      expect(fixture.id).toBe(name)
      expect(fixture.provenance).toBe('synthetic-model')
      expect(fixture.hostGuiEvidence).toBe('BLOCKED')
      const result = replayA02(fixture)
      expect(result.timeline).toEqual(fixture.expected.timeline)
      expect(result.sessions).toEqual(fixture.expected.sessions)
      expect(result.violations).toEqual([])
    })
  }
  it('keeps both branches in-flight until their own settle, even when one completes first', () => {
    const fixture = load('parallel-branches')
    const bothRunning = replayA02({ ...fixture, events: fixture.events.slice(0, 10) })
    expect(bothRunning.sessions['branch-a']?.inFlight).toEqual(['a-turn'])
    expect(bothRunning.sessions['branch-b']?.inFlight).toEqual(['b-turn'])
    const bFinished = replayA02({ ...fixture, events: fixture.events.slice(0, 11) })
    expect(bFinished.sessions['branch-a']?.inFlight).toEqual(['a-turn'])
    expect(bFinished.sessions['branch-b']?.inFlight).toEqual([])
  })
  it('rejects model selection changes while a request remains in-flight', () => {
    const fixture = structuredClone(load('menu-enter-exit'))
    fixture.events.splice(4, 1)
    expect(replayA02(fixture).violations).toContain('main: selection changed with in-flight requests')
  })
  it('rejects a non-Fusion selection dispatching through Fusion', () => {
    const fixture = structuredClone(load('menu-enter-exit'))
    fixture.events.push({ type: 'request', session: 'main', route: 'fusion', request: 'should-reject' })
    expect(replayA02(fixture).violations).toContain('main: request should-reject routes fusion while selection is ordinary')
  })
  it('rejects inherited fork activation without explicit selection', () => {
    const fixture = structuredClone(load('fork-activation'))
    fixture.events = fixture.events.filter(event => !(event.type === 'select' && event.session === 'fork-a'))
    expect(replayA02(fixture).violations).toContain('fork-a: request fork-request routes fusion while selection is ordinary')
  })
})
