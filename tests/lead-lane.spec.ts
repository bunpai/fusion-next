import { describe, expect, it } from 'vitest'
import { leadLaneDeny } from '../src/host/coordinator.js'

// M2.5 penetration matrix: the pair-mode Lead must hold NO workspace
// write/execute capability — every mutation goes through fusion_dispatch.
describe('leadLaneDeny penetration matrix (M2.5)', () => {
  it('denies every workspace-mutating primitive', () => {
    for (const name of ['write', 'edit', 'bash', 'pwsh', 'read_write', 'univer_execute', 'univer_compile_svg']) {
      expect(leadLaneDeny(name), name).toMatch(/fusion_dispatch/)
    }
  })
  it('denies unknown/unregistered tool names (fail-closed)', () => {
    expect(leadLaneDeny('definitely-not-a-tool')).toBeDefined()
    expect(leadLaneDeny('')).toBeDefined()
  })
  it('allows the lead analysis/delegation surface', () => {
    for (const name of [
      'read', 'grep', 'glob', 'tgrep', 'read_image',
      'web_fetch', 'web_search', 'subagent', 'run_code',
      'fusion_dispatch', 'job_list', 'job_output', 'job_kill',
      'list_agents', 'send_message', 'interrupt_agent', 'wait_agent',
      'todo_write', 'create_goal', 'get_goal', 'update_goal',
      'skill', 'workflow', 'exit_plan_mode', 'ask_user_question',
      'compress', 'decompress', 'search_context', 'acp_status', 'acp_cache',
    ]) {
      expect(leadLaneDeny(name), name).toBeUndefined()
    }
  })
  it('denial message is bilingual and names the denied tool', () => {
    const msg = leadLaneDeny('bash')!
    expect(msg).toContain('bash')
    expect(msg).toMatch(/没有工作区写/)
    expect(msg).toMatch(/no workspace write/)
  })
})
