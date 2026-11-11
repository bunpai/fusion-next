import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateFusionV2, openFusionV2, restoreFusionV1FromBackup } from '../src/persistence/index.js'
import { RouteCapabilityRegistry, type RouteCapability } from '../src/generation/service.js'
import { LegacyCompatibility } from '../src/compat/index.js'
import { defaultSettings, validateSettings } from '../src/settings/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-l01-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function makeLegacyV1Store(file: string): void {
  const db = new DatabaseSync(file)
  try {
    db.exec(`BEGIN;
      CREATE TABLE tasks (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
      CREATE TABLE artifacts (task_id TEXT NOT NULL REFERENCES tasks(id), digest TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(task_id, digest));
      CREATE TABLE documents (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, json TEXT NOT NULL, checksum TEXT NOT NULL);
      INSERT INTO tasks VALUES ('t-1', '{"status":"running"}');
      INSERT INTO artifacts VALUES ('t-1', 'd1', x'00ff10');
      INSERT INTO documents VALUES ('doc-1', 1, '{"text":"hi"}', 'cksum');
      PRAGMA user_version = 1;
      COMMIT;`)
  } finally { db.close() }
}

const capability: RouteCapability = { tools: true, contextWindow: 100_000, capabilityDigest: 'digest-legacy' }

describe('L01 v1 upgrade compatibility: data, settings, menu mapping', () => {
  it('migrates a v1 store without losing legacy tasks, artifacts or documents', () => {
    const file = path()
    makeLegacyV1Store(file)
    const result = migrateFusionV2(file)
    expect(result.migrated).toBe(true)
    expect(result.version).toBe(2)
    expect(result.backup).toBeDefined()
    const db = openFusionV2(file)
    try {
      const task = db.prepare('SELECT snapshot FROM tasks WHERE id = ?').get('t-1') as { snapshot: string }
      expect(task.snapshot).toBe('{"status":"running"}')
      const artifact = db.prepare('SELECT bytes FROM artifacts WHERE task_id = ? AND digest = ?').get('t-1', 'd1') as { bytes: Uint8Array }
      expect([...artifact.bytes]).toEqual([0, 255, 16])
      const document = db.prepare('SELECT json, revision FROM documents WHERE id = ?').get('doc-1') as { json: string; revision: number }
      expect(document).toEqual({ json: '{"text":"hi"}', revision: 1 })
      const fusionRuns = db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'fusion_%'`).get() as { n: number }
      expect(fusionRuns.n).toBeGreaterThanOrEqual(18)
    } finally { db.close() }
  })

  it('restores the v1 store byte-identical from the guarded backup', () => {
    const file = path()
    makeLegacyV1Store(file)
    const migrated = migrateFusionV2(file)
    expect(migrated.backup).toBeDefined()
    restoreFusionV1FromBackup(file, { path: migrated.backup!.path, sha256: migrated.backup!.sha256 }, { confirmOfflineExclusive: true })
    const db = new DatabaseSync(file)
    try {
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
      expect((db.prepare('SELECT snapshot FROM tasks WHERE id = ?').get('t-1') as { snapshot: string }).snapshot).toBe('{"status":"running"}')
      expect((db.prepare('SELECT checksum FROM documents WHERE id = ?').get('doc-1') as { checksum: string }).checksum).toBe('cksum')
    } finally { db.close() }
  })

  it('maps legacy menu models through the capability registry and refuses undeclared ones', () => {
    const registry = new RouteCapabilityRegistry()
    registry.declare('legacy-provider', 'claude-3', capability)
    const compat = new LegacyCompatibility()
    const mapped = compat.legacyModelRoute(registry, 'legacy-provider', 'claude-3')
    expect(mapped).toEqual({ verified: true, route: { provider: 'legacy-provider', model: 'claude-3', capabilityDigest: 'digest-legacy' } })
    const unknown = compat.legacyModelRoute(registry, 'legacy-provider', 'undeclared-model')
    expect(unknown.verified).toBe(false)
    if (!unknown.verified) {
      expect(unknown.reason).toMatch(/undeclared-model.*refused|refused.*undeclared-model/)
    }
  })

  it('keeps the old settings entry point working through the validated schema', () => {
    const compat = new LegacyCompatibility()
    expect(compat.legacySettings(defaultSettings())).toEqual({ ok: true, value: defaultSettings() })
    expect(() => compat.legacySettings({ pages: ['overview'] })).toThrow(/SETTINGS_INVALID/)
  })

  it('fails closed on a missing legacy binding instead of fabricating a session', () => {
    const compat = new LegacyCompatibility()
    expect(() => compat.assertLegacyBinding(undefined, 'session-1')).toThrow(/NEEDS_REPAIR.*session-1|session-1.*NEEDS_REPAIR/)
    expect(compat.assertLegacyBinding({ workerId: 'w-1' }, 'session-1')).toEqual({ workerId: 'w-1' })
  })
})
