import { createHash, randomUUID } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { verifyV2Schema } from './verify.js'

export interface FusionBackupReference { readonly path: string; readonly sha256: string }
export interface FusionRestoreOptions {
  /** Operator confirms services stopped and ALL database connections closed, including other processes. */
  readonly confirmOfflineExclusive?: boolean
}
export interface FusionRestoreResult { readonly restored: true; readonly v2Snapshot: FusionBackupReference }

function hash(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function regular(path: string): void {
  const entry = lstatSync(path)
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Fusion restore refuses symlink/non-file path')
}
function noSidecars(file: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    // An existing sidecar is enough to deny offline safety, including dangling symlinks.
    try { lstatSync(file + suffix) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new Error(`Fusion restore requires offline exclusive database; SQLite sidecar remains: ${suffix}`)
  }
}
function verifyDatabase(path: string, version: number): void {
  // immutable=true prevents read-only verification creating/using a WAL sidecar.
  const db = new DatabaseSync(`file:${encodeURI(path)}?immutable=1`, { readOnly: true, enableDoubleQuotedStringLiterals: false })
  try {
    if (db.prepare('PRAGMA user_version').get()?.user_version !== version) throw new Error('Fusion restore backup database version mismatch')
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('Fusion restore database integrity check failed')
    }
    if (version === 2) verifyV2Schema(db)
  } finally { db.close() }
}

/**
 * DESTRUCTIVE OFFLINE ROLLBACK. Caller MUST stop application/services and close all
 * SQLite handles across processes; this API cannot prove operator-enforced exclusivity.
 * Refuses visible sidecars and does not attempt to checkpoint a live WAL database.
 * Saves v2 for diagnostics before atomic same-directory rename of the verified v1 image.
 * Restore loses writes made since the v1 backup; explicit confirmation is mandatory.
 */
export function restoreFusionV1FromBackup(filename: string, backup: FusionBackupReference, options: FusionRestoreOptions = {}): FusionRestoreResult {
  if (options.confirmOfflineExclusive !== true) throw new Error('Fusion restore requires explicit offline exclusive consent')
  if (!filename || filename === ':memory:' || filename.includes('\0') || filename.startsWith('file:')) throw new Error('Fusion restore requires a regular database path')
  const path = resolve(filename)
  const parent = realpathSync(dirname(path))
  const file = join(parent, basename(path))
  regular(file)
  noSidecars(file)
  const backupPath = resolve(backup.path)
  if (realpathSync(dirname(backupPath)) !== parent || backupPath === file) throw new Error('Fusion restore backup must be in database directory')
  regular(backupPath)
  noSidecars(backupPath)
  if (!/^[a-f0-9]{64}$/.test(backup.sha256) || hash(backupPath) !== backup.sha256) throw new Error('Fusion restore backup SHA256 digest mismatch')
  verifyDatabase(backupPath, 1)
  verifyDatabase(file, 2)
  const diagnostic = join(parent, `${basename(file)}.v2-${randomUUID()}.bak`)
  const stage = join(parent, `${basename(file)}.restore-${randomUUID()}.tmp`)
  let staged = false
  try {
    copyFileSync(file, diagnostic, 1)
    regular(diagnostic)
    const v2Snapshot = { path: diagnostic, sha256: hash(diagnostic) }
    verifyDatabase(diagnostic, 2)
    copyFileSync(backupPath, stage, 1)
    staged = true
    regular(stage)
    if (hash(stage) !== backup.sha256) throw new Error('Fusion restore staged SHA256 digest mismatch')
    verifyDatabase(stage, 1)
    const fd = openSync(stage, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
    // Final defensive check; operator must still prevent other processes opening it.
    noSidecars(file)
    renameSync(stage, file)
    staged = false
    const dirFd = openSync(parent, 'r'); try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    return { restored: true, v2Snapshot }
  } finally { if (staged && existsSync(stage)) unlinkSync(stage) }
}
