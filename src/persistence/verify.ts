import { DatabaseSync } from 'node:sqlite'
import { FUSION_NEXT_V2_SQL, FUSION_NEXT_V2_TABLES } from './schema.js'

/** Verify full physical DDL, not just user_version: includes columns, FKs, constraints and indexes. */
let expected: Map<string, string> | undefined
function expectedDDL(): Map<string, string> {
  if (expected) return expected
  const reference = new DatabaseSync(':memory:')
  try {
    reference.exec(FUSION_NEXT_V2_SQL)
    expected = new Map(reference.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name LIKE 'fusion_%'").all()
      .map(row => [row.name as string, normalize(row.sql as string)]))
    return expected
  } finally { reference.close() }
}
function normalize(sql: string): string { return sql.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim().toLowerCase() }
export function verifyV2Schema(db: DatabaseSync): void {
  const actual = new Map(db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name LIKE 'fusion_%'").all()
    .map(row => [row.name as string, normalize(row.sql as string)]))
  for (const [name, ddl] of expectedDDL()) {
    if (actual.get(name) !== ddl) throw new Error(`Fusion v2 schema mismatch: ${name}`)
  }
  for (const name of FUSION_NEXT_V2_TABLES) {
    if (!actual.has(name)) throw new Error(`Fusion v2 schema missing table: ${name}`)
  }
}
