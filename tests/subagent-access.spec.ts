import { describe, expect, it } from 'vitest'
import { subagentDelegateSpec } from '../src/host/coordinator.js'

const worker = { provider: 'cpa', model: 'devin/deepseek-v4-flash' }

describe('subagentDelegateSpec', () => {
  it('routes the child to the paired executor model', () => {
    const spec = subagentDelegateSpec({ description: 'explore', prompt: 'find callers' }, worker, 2)
    expect(spec.agentOptions).toEqual({ provider: 'cpa', model: 'devin/deepseek-v4-flash' })
    expect(spec.prompt[0].text).toBe('find callers')
    expect(spec.maxDepth).toBe(2)
  })

  it('passes the prompt through verbatim', () => {
    const spec = subagentDelegateSpec({ prompt: 'compare a.sh vs b.sh' }, worker, 1)
    expect(spec.prompt).toEqual([{ type: 'text', text: 'compare a.sh vs b.sh' }])
  })

  it('falls back to description when prompt is missing or blank', () => {
    expect(subagentDelegateSpec({ description: 'diff summary' }, worker, 1).prompt[0].text).toBe('diff summary')
    expect(subagentDelegateSpec({ description: 'diff summary', prompt: '   ' }, worker, 1).prompt[0].text).toBe('diff summary')
    expect(subagentDelegateSpec({}, worker, 1).prompt[0].text).toBe('Sidekick investigation')
  })

  it('labels the child from the description', () => {
    const spec = subagentDelegateSpec({ description: 'check exports' }, worker, 1)
    expect(spec.label).toBe('check exports')
  })

  it('caps the label at 40 characters', () => {
    const spec = subagentDelegateSpec({ description: 'x'.repeat(80) }, worker, 1)
    expect(spec.label.length).toBe(40)
  })

  it('ignores caller-supplied provider/model args — the worker route wins', () => {
    const spec = subagentDelegateSpec({ prompt: 'x', provider: 'evil', model: 'evil-model' } as never, worker, 1)
    expect(spec.agentOptions).toEqual(worker)
  })
})
