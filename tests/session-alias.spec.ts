import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager, type RunManager } from '../src/run-manager/index.js'
import { resolveOrCreateAlias } from '../src/session/session-alias.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-c01-alias-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const createIntent = { kind: 'create' as const, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT' as const }

describe('C01 session alias resolution', () => {
  it('creates a run and alias with deterministic identities', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const resolution = resolveOrCreateAlias(manager, 'session-a', createIntent)
      expect(resolution.created).toBe(true)
      expect(resolution.runId).toBe('fusion-run-session-a')
      expect(resolution.alias.hostSessionId).toBe('session-a')
      expect(resolution.alias.selectionStatus).toBe('INACTIVE')
      expect(manager.getRun(resolution.runId)?.status).toBe('ACTIVATING')
      expect(manager.listEvents(resolution.runId)).toHaveLength(1)
    } finally { manager.close() }
  })

  it('returns the existing binding unchanged when called again with the same intent', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const first = resolveOrCreateAlias(manager, 'session-b', createIntent)
      const retry = resolveOrCreateAlias(manager, 'session-b', createIntent)
      expect(retry).toMatchObject({ runId: first.runId, created: false })
      expect(manager.listEvents(first.runId)).toHaveLength(1)
    } finally { manager.close() }
  })

  it('never rebinds an existing alias, even under a different create intent', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const first = resolveOrCreateAlias(manager, 'session-c', createIntent)
      const other = resolveOrCreateAlias(manager, 'session-c', { ...createIntent, taskId: 'task-x', budgetId: 'budget-x', mode: 'DELEGATE' as const })
      expect(other).toMatchObject({ runId: first.runId, created: false })
      expect(manager.listEvents(first.runId)).toHaveLength(1)
      expect(manager.getState().runs['fusion-run-session-c']?.taskId).toBe('task-1')
    } finally { manager.close() }
  })

  it('fails closed with NEEDS_REPAIR when restoring an unbound session', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      const before = manager.getState()
      expect(() => resolveOrCreateAlias(manager, 'session-ghost', { kind: 'restore' })).toThrow(/NEEDS_REPAIR/)
      expect(manager.getState()).toEqual(before)
    } finally { manager.close() }
  })

  it('rejects invalid host session identifiers', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      expect(() => resolveOrCreateAlias(manager, '', createIntent)).toThrow(TypeError)
      expect(() => resolveOrCreateAlias(manager, 'bad\0id', createIntent)).toThrow(TypeError)
    } finally { manager.close() }
  })

  it('keeps task and budget identities globally unique across sessions', () => {
    const file = path(); migrateFusionV2(file)
    const manager = openRunManager(file)
    try {
      resolveOrCreateAlias(manager, 'session-1', createIntent)
      expect(() => resolveOrCreateAlias(manager, 'session-2', createIntent)).toThrow(/task\/budget identity must be unique/)
    } finally { manager.close() }
  })
})
