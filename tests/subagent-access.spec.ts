import { describe, expect, it } from 'vitest'
import { subagentAccess } from '../src/host/coordinator.js'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const route = { provider: 'cpa', model: 'devin/deepseek-v4-flash' }
const exec = (name: string, args: Record<string, unknown> = {}): Readonly<ToolExecution> =>
  ({ name, arguments: args }) as Readonly<ToolExecution>

describe('subagentAccess', () => {
  it('allows subagent with the paired executor provider and model', () => {
    expect(subagentAccess(exec('subagent', { provider: 'cpa', model: 'devin/deepseek-v4-flash', prompt: 'read a.sh' }), route)).toBeUndefined()
  })

  it('denies subagent when provider is missing', () => {
    const denied = subagentAccess(exec('subagent', { model: 'devin/deepseek-v4-flash', prompt: 'read' }), route)
    expect(denied).toContain('FUSION_NEXT_LEAD_READ_ONLY')
    expect(denied).toContain('cpa')
    expect(denied).toContain('devin/deepseek-v4-flash')
  })

  it('denies subagent when model is missing', () => {
    const denied = subagentAccess(exec('subagent', { provider: 'cpa', prompt: 'read' }), route)
    expect(denied).toContain('FUSION_NEXT_LEAD_READ_ONLY')
    expect(denied).toContain('devin/deepseek-v4-flash')
  })

  it('denies subagent when both provider and model are missing', () => {
    const denied = subagentAccess(exec('subagent', { prompt: 'read' }), route)
    expect(denied).toContain('FUSION_NEXT_LEAD_READ_ONLY')
  })

  it('denies subagent when provider mismatches the executor', () => {
    const denied = subagentAccess(exec('subagent', { provider: 'other', model: 'devin/deepseek-v4-flash', prompt: 'read' }), route)
    expect(denied).toContain('FUSION_NEXT_LEAD_READ_ONLY')
    expect(denied).toContain('cpa')
  })

  it('denies subagent when model mismatches the executor', () => {
    const denied = subagentAccess(exec('subagent', { provider: 'cpa', model: 'devin/swe-2', prompt: 'read' }), route)
    expect(denied).toContain('FUSION_NEXT_LEAD_READ_ONLY')
    expect(denied).toContain('devin/deepseek-v4-flash')
  })

  it('denies subagent_fork because it inherits the lead model', () => {
    const denied = subagentAccess(exec('subagent_fork', { prompt: 'read' }), route)
    expect(denied).toContain('FUSION_NEXT_LEAD_READ_ONLY')
    expect(denied).toContain('subagent')
    expect(denied).toContain('paired executor')
  })

  it('allows subagent with no arguments beyond provider/model', () => {
    expect(subagentAccess(exec('subagent', { provider: 'cpa', model: 'devin/deepseek-v4-flash' }), route)).toBeUndefined()
  })
})
