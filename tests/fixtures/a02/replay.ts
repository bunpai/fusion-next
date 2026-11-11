export type A02Event =
  | { type: 'open'; session: string; historical?: boolean; selected?: 'fusion' | 'ordinary' }
  | { type: 'select'; session: string; route: 'fusion' | 'ordinary' }
  | { type: 'activate'; session: string }
  | { type: 'fork'; session: string; from: string }
  | { type: 'request'; session: string; route: 'fusion' | 'ordinary'; request: string }
  | { type: 'settle'; session: string; request: string }

export type A02Session = { selection: 'fusion' | 'ordinary'; active: boolean; parent: string | null; inFlight: string[] }
export type A02Scenario = {
  id: string
  provenance: 'synthetic-model'
  hostGuiEvidence: 'BLOCKED'
  description: string
  events: A02Event[]
  expected: { timeline: string[]; sessions: Record<string, A02Session> }
}

/** Pure synthetic state machine; never invokes nor claims to observe the Host. */
export function replayA02(scenario: A02Scenario): { timeline: string[]; sessions: Record<string, A02Session>; violations: string[] } {
  const sessions: Record<string, A02Session> = {}
  const timeline: string[] = []
  const violations: string[] = []
  for (const event of scenario.events) {
    if (event.type === 'open') {
      if (sessions[event.session]) violations.push(`${event.session}: duplicate open`)
      else sessions[event.session] = { selection: event.selected ?? 'ordinary', active: false, parent: null, inFlight: [] }
      timeline.push(`open:${event.session}:${event.historical ? 'history' : 'new'}`)
      continue
    }
    if (event.type === 'fork') {
      if (!sessions[event.from]) violations.push(`${event.session}: missing parent ${event.from}`)
      if (sessions[event.session]) violations.push(`${event.session}: duplicate fork`)
      else sessions[event.session] = { selection: 'ordinary', active: false, parent: event.from, inFlight: [] }
      timeline.push(`fork:${event.from}->${event.session}`)
      continue
    }
    const state = sessions[event.session]
    if (!state) { violations.push(`${event.session}: event before open`); continue }
    if (event.type === 'select') {
      if (state.inFlight.length) violations.push(`${event.session}: selection changed with in-flight requests`)
      state.selection = event.route
      timeline.push(`select:${event.session}:${event.route}`)
    } else if (event.type === 'activate') {
      state.active = true
      timeline.push(`activate:${event.session}:${state.selection}`)
    } else if (event.type === 'request') {
      if (!state.active) violations.push(`${event.session}: request ${event.request} before activation`)
      if (event.route !== state.selection) violations.push(`${event.session}: request ${event.request} routes ${event.route} while selection is ${state.selection}`)
      if (state.inFlight.includes(event.request)) violations.push(`${event.session}: duplicate in-flight ${event.request}`)
      state.inFlight.push(event.request)
      timeline.push(`request:${event.session}:${event.request}:${event.route}`)
    } else {
      if (!state.inFlight.includes(event.request)) violations.push(`${event.session}: settle without request ${event.request}`)
      state.inFlight = state.inFlight.filter(id => id !== event.request)
      timeline.push(`settle:${event.session}:${event.request}`)
    }
  }
  return { timeline, sessions, violations }
}
