import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TaskId } from '../src/contracts.js'
import { NativeFusionScopes } from '../src/host/native-scopes.js'
import { completeProfile } from '../src/profile/resolve.js'

const prompts = { lead: 'Lead', worker: 'Worker', compact: 'Checkpoint' }
const profile = completeProfile({ id: 'fusion-auto', version: 'faithful-v1', enabled: true,
  lead: { provider: 'configured', model: 'lead' }, worker: { provider: 'configured', model: 'worker' } }, prompts)

function agent(): Agent {
  const dispose = () => {}
  return {
    id: 'lead-1',
    status: 'idle',
    ctx: {
      tools: { guard: () => dispose, restrict: () => dispose, presentAs: () => dispose },
      on: () => dispose,
      systemPrompt: { section: () => dispose },
    },
  } as unknown as Agent
}

describe('NativeFusionScopes.install tool order', () => {
  it('runs installTools before refreshTools', () => {
    const order: string[] = []
    const scopes = new NativeFusionScopes({
      canRequest: () => undefined,
      canExecute: () => undefined,
      beforeRequest: () => {},
      installTools: () => {
        order.push('installTools')
        return [() => {}]
      },
      readOnlyTools: () => {
        order.push('refreshTools')
        return ['fusion_delegate', 'fusion_explore']
      },
    })
    scopes.install(agent(), {
      schemaVersion: 1, sessionId: 'lead-1', taskId: TaskId('task-1'), selected: true, profile, prompts,
    }, 'lead')
    expect(order).toEqual(['installTools', 'refreshTools'])
  })
})

describe('NativeFusionScopes Host SDK compatibility', () => {
  const scopes = () => new NativeFusionScopes({
    canRequest: () => undefined,
    canExecute: () => undefined,
    beforeRequest: () => {},
    installTools: () => [],
    readOnlyTools: () => ['fusion_delegate'],
  })
  const binding = (): Parameters<NativeFusionScopes['install']>[1] => ({ schemaVersion: 1, sessionId: 'lead-1', taskId: TaskId('task-1'), selected: true, profile, prompts })
  it('installs on a Host without presentAs (0.2.2-rc.1): presentation is cosmetic', () => {
    const bare = agent() as unknown as { ctx: { tools: Record<string, unknown>; on: () => () => void; systemPrompt: { section: () => () => void } } }
    bare.ctx = { tools: { guard: () => () => {}, restrict: () => () => {} }, on: () => () => {}, systemPrompt: { section: () => () => {} } }
    expect(() => scopes().install(bare as unknown as Agent, binding(), 'lead')).not.toThrow()
  })
  it('fails closed when a Worker allowlist needs restrict() and the Host lacks it', () => {
    const bare = agent() as unknown as { ctx: { tools: Record<string, unknown>; on: () => () => void; systemPrompt: { section: () => () => void } } }
    bare.ctx = { tools: { guard: () => () => {}, presentAs: () => () => {} }, on: () => () => {}, systemPrompt: { section: () => () => {} } }
    expect(() => scopes().install(bare as unknown as Agent, binding(), 'worker')).toThrow(/scope\.tools\.restrict/)
  })
})
