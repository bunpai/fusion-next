import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteFusionStore } from '../src/task/sqlite-store.js'
import { created, TASK } from './helpers.js'
import { migrateFusionV2, openFusionV2, FUSION_V2_TABLES } from '../src/persistence/index.js'

const dirs: string[] = []
const handles: DatabaseSync[] = []
function dbPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'fusion-v2-'))
  dirs.push(directory)
  return join(directory, 'state.sqlite')
}
function raw(file: string): DatabaseSync {
  const db = new DatabaseSync(file); handles.push(db); return db
}
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Fusion persistence v1 → v2 additive migration', () => {
  it('retains legacy task snapshots, evidence bytes and documents and creates all planned tables', () => {
    const file = dbPath()
    const legacy = new SqliteFusionStore(file)
    legacy.create(created())
    const evidence = legacy.putArtifact(TASK, Buffer.from('legacy evidence'), 'text/plain')
    legacy.writeDocument('legacy:record', 0, { keep: true })
    legacy.close()
    const result = migrateFusionV2(file)
    expect(result.migrated).toBe(true)
    expect(result.backup?.path).toBeTruthy()
    expect(existsSync(result.backup!.path)).toBe(true)
    expect(result.backup?.sha256).toMatch(/^[a-f0-9]{64}$/)
    const backup = raw(result.backup!.path)
    expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
    expect(backup.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
    const db = raw(file)
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
    expect(tables).toEqual(expect.arrayContaining([...FUSION_V2_TABLES, 'tasks', 'artifacts', 'documents']))
    expect(db.prepare('SELECT id FROM tasks').get()?.id).toBe(TASK)
    expect(Buffer.from(db.prepare('SELECT bytes FROM artifacts').get()?.bytes as Uint8Array).toString()).toBe('legacy evidence')
    expect(db.prepare('SELECT json FROM documents WHERE id=?').get('legacy:record')?.json).toBe('{"keep":true}')
    expect(db.prepare('SELECT digest FROM artifacts').get()?.digest).toBe(evidence.digest)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
    expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
    const upgradedStore = new SqliteFusionStore(file)
    expect(upgradedStore.load(TASK)?.taskId).toBe(TASK)
    expect(Buffer.from(upgradedStore.readArtifact(TASK, evidence.digest)).toString()).toBe('legacy evidence')
    expect(upgradedStore.readDocument('legacy:record')?.value).toEqual({ keep: true })
    upgradedStore.writeDocument('legacy:record', 1, { keep: 'writable' })
    upgradedStore.close()
  })

  it('keeps WAL FULL and does not create further backups or alter data on repeated migration', () => {
    const file = dbPath()
    const legacy = new SqliteFusionStore(file)
    legacy.writeDocument('persisted', 0, { answer: 42 })
    legacy.close()
    const first = migrateFusionV2(file)
    const backupBytes = readFileSync(first.backup!.path)
    const second = migrateFusionV2(file)
    expect(second).toEqual({ migrated: false, version: 2 })
    expect(readFileSync(first.backup!.path)).toEqual(backupBytes)
    const db = openFusionV2(file); handles.push(db)
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal')
    expect(db.prepare('PRAGMA synchronous').get()?.synchronous).toBe(2)
    expect(db.prepare('SELECT json FROM documents WHERE id=?').get('persisted')?.json).toBe('{"answer":42}')
  })

  it('creates v2 on an empty path and rejects future versions and unversioned populated files', () => {
    const fresh = dbPath()
    expect(() => openFusionV2(fresh)).toThrow(/migrateFusionV2 first/)
    expect(migrateFusionV2(fresh).version).toBe(2)
    expect(migrateFusionV2(fresh).migrated).toBe(false)
    const future = dbPath()
    const db = raw(future)
    db.exec('PRAGMA user_version = 77')
    expect(() => migrateFusionV2(future)).toThrow(/version/i)
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(77)
    const unversioned = dbPath()
    raw(unversioned).exec('CREATE TABLE alien (id TEXT)')
    expect(() => migrateFusionV2(unversioned)).toThrow(/unversioned/i)
  })

  it('enforces foreign keys, event run sequence uniqueness and rollback of failed writes', () => {
    const file = dbPath()
    migrateFusionV2(file)
    const db = openFusionV2(file); handles.push(db)
    expect(() => db.prepare('INSERT INTO fusion_session_aliases(host_session_id,run_id,selection_status,revision) VALUES (?,?,?,?)')
      .run('session', 'missing-run', 'ACTIVE', 1)).toThrow()
    db.prepare('INSERT INTO fusion_runs(id,task_id,current_host_session,status,mode,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('run', 'task', 'session', 'RUNNING', 'DIRECT', 1, 1, 1)
    db.prepare('INSERT INTO fusion_events(event_id,run_id,seq,type,payload_json,schema_version,timestamp) VALUES (?,?,?,?,?,?,?)')
      .run('event-1', 'run', 1, 'RUN_CREATED', '{}', 1, 1)
    expect(() => db.prepare('INSERT INTO fusion_events(event_id,run_id,seq,type,payload_json,schema_version,timestamp) VALUES (?,?,?,?,?,?,?)')
      .run('event-2', 'run', 1, 'RUN_CREATED', '{}', 1, 1)).toThrow()
    expect(() => db.exec(`BEGIN IMMEDIATE;
      INSERT INTO fusion_session_aliases(host_session_id,run_id,selection_status,revision) VALUES ('valid','run','ACTIVE',1);
      INSERT INTO fusion_session_aliases(host_session_id,run_id,selection_status,revision) VALUES ('bad','absent','ACTIVE',1);
      COMMIT;`)).toThrow()
    db.exec('ROLLBACK')
    expect(db.prepare('SELECT count(*) AS count FROM fusion_session_aliases').get()?.count).toBe(0)
    expect(db.prepare('SELECT count(*) AS count FROM fusion_events').get()?.count).toBe(1)
  })

  it('refuses unsafe file locations and leaves existing v1 untouched if migration fails', () => {
    const file = dbPath()
    const legacy = new SqliteFusionStore(file); legacy.writeDocument('safe', 0, true); legacy.close()
    expect(() => migrateFusionV2(file, { beforeCommit: () => { throw new Error('injected failure') } })).toThrow('injected failure')
    const db = raw(file)
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
    expect(db.prepare('SELECT json FROM documents WHERE id=?').get('safe')?.json).toBe('true')
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='fusion_runs'").get()?.n).toBe(0)
    expect(() => migrateFusionV2(':memory:')).toThrow(/path|memory|backup/i)
    const dangling = dbPath()
    symlinkSync(join(dirname(dangling), 'nonexistent-target.sqlite'), dangling)
    expect(() => migrateFusionV2(dangling)).toThrow(/regular file/)
  })
})
