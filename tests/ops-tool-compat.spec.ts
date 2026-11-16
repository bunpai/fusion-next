import { describe, expect, it } from 'vitest'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { isLeadShell, isRead } from '../src/host/coordinator.js'

const exec = (name: string, args: Record<string, unknown> = {}): Readonly<ToolExecution> =>
  ({ name, arguments: args }) as Readonly<ToolExecution>

describe('ops_* tool-replacement compatibility (dsh-ops)', () => {
  it('classifies dsh-ops read replacements as read-only', () => {
    const reads = [
      'ops_glob', 'ops_grep', 'ops_read', 'ops_read_files', 'ops_read_many',
      'ops_read_docx', 'ops_read_pdf', 'ops_read_table', 'ops_inspect_local_file',
      'ops_stat', 'ops_diff', 'ops_status', 'ops_discover_tools', 'ops_result',
      'ops_job_output', 'ops_job_list',
    ]
    for (const name of reads) expect(isRead(exec(name)), name).toBe(true)
  })

  it('keeps ops_* mutators classified as mutations', () => {
    const mutations = [
      'ops_write_file', 'ops_edit_file', 'ops_edit_many', 'ops_replace', 'ops_remove',
      'ops_run', 'ops_run_background', 'ops_batch', 'ops_job_kill', 'ops_bash',
    ]
    for (const name of mutations) expect(isRead(exec(name)), name).toBe(false)
  })

  it('routes ops_bash through the lead shell gate like native bash', () => {
    expect(isLeadShell('ops_bash')).toBe(true)
    expect(isLeadShell('bash')).toBe(true)
    expect(isLeadShell('pwsh')).toBe(true)
    expect(isLeadShell('ops_run')).toBe(false)
    expect(isLeadShell('ops_write_file')).toBe(false)
  })

  it('still honours the str_replace_editor view exception', () => {
    expect(isRead(exec('str_replace_editor', { command: 'view' }))).toBe(true)
    expect(isRead(exec('str_replace_editor', { command: 'create' }))).toBe(false)
  })
})
