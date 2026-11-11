import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FUSION_V2_SQL, FUSION_V2_TABLES } from './schema.js'

export { FUSION_V2_TABLES } from './schema.js'
export interface FusionMigrationResult { readonly migrated: boolean; readonly version: 2; readonly backup?: { readonly path: string; readonly sha256: string } }
export interface FusionMigrationOptions { /** Failure injection for transactional verification; invoked before COMMIT. */ readonly beforeCommit?: () => void }

/** Paths are filesystem-only: no SQLite URI, special database, or symlink traversal. */
function checkedPath(filename: string): string {
  if (!filename || filename === ':memory:' || filename.includes('\0') || filename.startsWith('file:')) {
    throw new Error('Fusion v2 requires a real filesystem backup path')
  }
  const path = resolve(filename)
  mkdirSync(dirname(path), { recursive: true })
  // Canonicalize parent directories (macOS /var → /private/var is commonplace).
  // The terminal database file itself must not be a symlink.
  const parent = realpathSync(dirname(path))
  const safePath = join(parent, path.slice(dirname(path).length + 1))
  // lstat catches even dangling symlinks (existsSync would report those as absent).
  let entry: ReturnType<typeof lstatSync> | undefined
  try { entry = lstatSync(safePath) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (entry && (!entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('Fusion v2 database path must be a regular file')
  }
  return safePath
}

function userVersion(db: DatabaseSync): number {
  const version = db.prepare('PRAGMA user_version').get()?.user_version
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) throw new Error('invalid Fusion database version')
  if (version > 2 || version < 0) throw new Error(`unsupported future Fusion database version ${version}`)
  return version
}

function verify(db: DatabaseSync): void {
  if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Fusion database integrity check failed')
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Fusion database foreign key check failed')
}

function legacySchema(db: DatabaseSync): void {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name)
  if (!names.length) {
    db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
      CREATE TABLE artifacts (task_id TEXT NOT NULL REFERENCES tasks(id), digest TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(task_id, digest));
      CREATE TABLE documents (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, json TEXT NOT NULL, checksum TEXT NOT NULL);`)
  } else throw new Error('unversioned nonempty Fusion database')
}

/** SQLite VACUUM INTO includes committed WAL frames and produces a self-contained, validated snapshot. */
function snapshot(db: DatabaseSync, filename: string): { path: string; sha256: string } {
  const path = join(dirname(filename), `${basename(filename)}.v1-${randomUUID()}.bak`)
  // VACUUM INTO cannot run inside an active transaction; it captures a consistent SQLite snapshot.
  // The destination is generated in the same verified directory; quotes are escaped for SQLite.
  try {
    db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`)
    const backup = new DatabaseSync(path, { readOnly: true })
    try {
      if (userVersion(backup) !== 1) throw new Error('Fusion backup has unexpected version')
      verify(backup)
    } finally { backup.close() }
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    return { path, sha256 }
  } catch (error) {
    // Preserve successfully generated backups for diagnosis; remove incomplete files only.
    if (existsSync(path) && statSync(path).size === 0) unlinkSync(path)
    throw error
  }
}

/** Explicit one-time v1→v2 migration; never called implicitly by legacy SqliteFusionStore. */
export function migrateFusionV2(filename: string, options: FusionMigrationOptions = {}): FusionMigrationResult {
  const path = checkedPath(filename)
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    const version = userVersion(db)
    if (version === 2) { verify(db); return { migrated: false, version: 2 } }
    if (version === 0) {
      const count = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()?.n
      if (count !== 0) throw new Error('unversioned nonempty Fusion database')
    }
    // VACUUM INTO must run outside a write transaction. data_version detects other
    // connections committing between the snapshot and our acquired writer lock;
    // those races abort rather than accepting a stale backup. Operators must also
    // stop non-cooperating writers while performing an application upgrade.
    const beforeBackup = db.prepare('PRAGMA data_version').get()?.data_version
    const backup = version === 1 ? snapshot(db, path) : undefined
    db.exec('BEGIN IMMEDIATE')
    try {
      // Revalidate under the writer lock; never overwrite another writer's concurrent migration.
      if (userVersion(db) !== version) throw new Error('Fusion database version changed during migration')
      if (db.prepare('PRAGMA data_version').get()?.data_version !== beforeBackup) {
        throw new Error('Fusion database changed during backup; retry migration with exclusive writer access')
      }
      if (version === 0) legacySchema(db)
      verify(db)
      db.exec(FUSION_V2_SQL)
      db.exec('PRAGMA user_version = 2')
      options.beforeCommit?.()
      verify(db)
      db.exec('COMMIT')
      return { migrated: true, version: 2, ...(backup ? { backup } : {}) }
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  } finally { db.close() }
}

/** B03 can use this single connection for its own BEGIN IMMEDIATE state + outbox transactions. */
export function openFusionV2(filename: string): DatabaseSync {
  const path = checkedPath(filename)
  if (!existsSync(path)) throw new Error('Fusion v2 database missing; call migrateFusionV2 first')
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    if (userVersion(db) !== 2) throw new Error('Fusion v2 database required')
    return db
  } catch (error) { db.close(); throw error }
}
