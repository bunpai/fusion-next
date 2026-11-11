/** B03 SQLite domain writer: no Host subscriptions, effect dispatch, or implicit migrations. */
import type { DatabaseSync } from 'node:sqlite'
import { openFusionV2 } from '../persistence/index.js'
import {
  emptyLifecycleState, reduceLifecycle, type FusionRunId, type SessionAliasId,
  type LifecycleEvent, type LifecycleState, type FusionRun, type SessionAlias,
} from '../lifecycle/index.js'

export type RunEventInput = Omit<LifecycleEvent, 'seq' | 'expectedRevision'>
export interface AppendOptions { /** Transaction fault injection; executed after all writes, before COMMIT. */ beforeCommit?: () => void }
export interface StoredRunEvent { eventId: string; runId: FusionRunId; seq: number; type: string; payload: LifecycleEvent }
/** Durable global sequence encoded in payload_json, independent of rowid and VACUUM. */
export interface JournalEvent extends StoredRunEvent { cursor: number }

const conflict = (message: string): never => { throw new Error(`Fusion RunManager conflict: ${message}`) }
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item)
}

/** One connection per manager; BEGIN IMMEDIATE serializes writes across independent managers. */
export class RunManager {
  private readonly db: DatabaseSync
  private closed = false
  private readonly subscribers = new Set<(message: StoredRunEvent) => void>()
  constructor(filename: string) { this.db = openFusionV2(filename) }
  /** In-process post-COMMIT notifications only; durable replay remains the event ledger. */
  subscribe(callback: (message: StoredRunEvent) => void): () => void {
    this.ensureOpen()
    this.subscribers.add(callback)
    return () => { this.subscribers.delete(callback) }
  }
  private ensureOpen(): void { if (this.closed) throw new Error('RunManager is closed') }
  private events(): StoredRunEvent[] {
    return this.db.prepare("SELECT event_id, run_id, seq, type, payload_json FROM fusion_events ORDER BY CAST(json_extract(payload_json, '$.seq') AS INTEGER)").all()
      .map(row => ({ eventId: String(row.event_id), runId: String(row.run_id) as FusionRunId,
        seq: Number(row.seq), type: String(row.type), payload: JSON.parse(String(row.payload_json)) as LifecycleEvent }))
  }
  private replay(): LifecycleState {
    let state = emptyLifecycleState()
    for (const item of this.events()) {
      // B01 reducer uses a single total order. SQLite has per-run seq/revision;
      // translating the persisted ordered log is the B03 adapter's responsibility.
      const { seq: _seq, expectedRevision: _revision, ...payload } = item.payload
      state = reduceLifecycle(state, { ...payload, seq: state.seq + 1, expectedRevision: state.revision } as LifecycleEvent)
    }
    return state
  }
  getState(): LifecycleState { this.ensureOpen(); return this.replay() }
  getRun(runId: FusionRunId): FusionRun | undefined { return this.getState().runs[runId] }
  getAlias(sessionId: SessionAliasId): SessionAlias | undefined { return this.getState().aliases[sessionId] }
  listEvents(runId: FusionRunId): StoredRunEvent[] { this.ensureOpen(); return this.events().filter(item => item.runId === runId) }
  /** Committed journal is the durable outbox. Persist cursor externally after handling each event.
   * Consumers can replay from their last durable cursor after restart; delivery is at-least-once.
   * This cursor is the global reducer seq stored in payload, NOT SQLite rowid (VACUUM-safe).
   * subscribe() is best-effort only and must not be used for reliable delivery.
   */
  readEventsSince(cursor: number, limit = 100): JournalEvent[] {
    this.ensureOpen()
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      conflict('invalid journal cursor or limit')
    }
    return this.db.prepare(`SELECT event_id, run_id, seq, type, payload_json FROM fusion_events
      WHERE CAST(json_extract(payload_json, '$.seq') AS INTEGER) > ?
      ORDER BY CAST(json_extract(payload_json, '$.seq') AS INTEGER) LIMIT ?`).all(cursor, limit)
      .map(row => {
        const payload = JSON.parse(String(row.payload_json)) as LifecycleEvent
        return { eventId: String(row.event_id), runId: String(row.run_id) as FusionRunId,
          seq: Number(row.seq), type: String(row.type), payload, cursor: payload.seq }
      })
  }
  foreignKeyViolations(): unknown[] { this.ensureOpen(); return this.db.prepare('PRAGMA foreign_key_check').all() }

  /** expectedRevision is scoped to event.runId; fork parents are checked under the same writer lock. */
  append(input: RunEventInput, expectedRevision: number, options: AppendOptions = {}): LifecycleState {
    this.ensureOpen()
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) conflict('invalid expected revision')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const prior = this.events()
      const existing = prior.find(item => item.eventId === input.eventId)
      if (existing) {
        const { seq: _seq, expectedRevision: _revision, ...saved } = existing.payload
        if (canonical(saved) !== canonical(input) || existing.runId !== input.runId) conflict('event id reused with different contents')
        this.db.exec('COMMIT')
        return this.replay()
      }
      const before = this.replay()
      const runRevision = this.db.prepare('SELECT revision FROM fusion_runs WHERE id = ?').get(input.runId)?.revision
      const actualRevision = runRevision === undefined ? 0 : Number(runRevision)
      if (actualRevision !== expectedRevision) conflict(`stale per-run revision/CAS: expected ${expectedRevision}, actual ${actualRevision}`)
      const perRunSeq = Number(this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM fusion_events WHERE run_id = ?').get(input.runId)?.seq) + 1
      const payload = { ...input, seq: before.seq + 1, expectedRevision: before.revision } as LifecycleEvent
      const next = reduceLifecycle(before, payload)
      this.persistProjection(next, input.runId, actualRevision + 1)
      this.db.prepare('INSERT INTO fusion_events (event_id, run_id, seq, type, payload_json, schema_version, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.eventId, input.runId, perRunSeq, input.type, canonical(payload), 1, Date.now())
      options.beforeCommit?.()
      this.db.exec('COMMIT')
      const committed: StoredRunEvent = { eventId: input.eventId, runId: input.runId, seq: perRunSeq, type: input.type, payload }
      for (const subscriber of this.subscribers) {
        try { subscriber(committed) } catch { /* user callbacks cannot invalidate a committed transaction */ }
      }
      return next
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  private persistProjection(state: LifecycleState, changedRunId: FusionRunId, runRevision: number): void {
    const now = Date.now()
    // Upsert runs before FK dependents. Every projection update belongs to the same write transaction.
    const insertRun = this.db.prepare(`INSERT INTO fusion_runs (id,task_id,current_host_session,status,mode,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET current_host_session=excluded.current_host_session,
      status=excluded.status,mode=excluded.mode,revision=excluded.revision,updated_at=excluded.updated_at`)
    for (const run of Object.values(state.runs)) {
      const old = this.db.prepare('SELECT revision FROM fusion_runs WHERE id = ?').get(run.id)
      insertRun.run(run.id, run.taskId, run.hostSessionId, run.status, run.mode,
        run.id === changedRunId ? runRevision : Number(old?.revision ?? 0), now, now)
    }
    // Lineage root branches are identifiers, not guaranteed recorded lineage nodes.
    // Only reference a parent_branch_id when its physical lineage row already exists.
    const lineageInsert = this.db.prepare(`INSERT INTO fusion_branch_lineage (branch_id,parent_branch_id,parent_run_id,fork_point_seq,created_at)
      VALUES (?,?,?,?,?) ON CONFLICT(branch_id) DO NOTHING`)
    for (const branch of Object.values(state.lineage)) {
      const parent = branch.parentBranchId && this.db.prepare('SELECT 1 AS ok FROM fusion_branch_lineage WHERE branch_id=?').get(branch.parentBranchId)
      lineageInsert.run(branch.branchId, parent ? (branch.parentBranchId ?? null) : null, branch.parentRunId, branch.forkPointSeq, now)
    }
    const aliasInsert = this.db.prepare(`INSERT INTO fusion_session_aliases (host_session_id,run_id,selection_status,branch_id,fork_point_seq,revision)
      VALUES (?,?,?,?,?,?) ON CONFLICT(host_session_id) DO UPDATE SET selection_status=excluded.selection_status,revision=excluded.revision`)
    for (const alias of Object.values(state.aliases)) {
      // The root branch need not be present in lineage. For children the FK resolves.
      const physicalBranch = alias.branchId && state.lineage[alias.branchId] ? alias.branchId : null
      aliasInsert.run(alias.hostSessionId, alias.runId, alias.selectionStatus, physicalBranch, alias.forkPointSeq ?? null, alias.revision)
    }
    const agents = this.db.prepare(`INSERT INTO fusion_agents (agent_id,run_id,role,permission_profile,current_generation_id)
      VALUES (?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET current_generation_id=excluded.current_generation_id`)
    for (const run of Object.values(state.runs)) for (const agentId of run.agentIds) {
      const storedOwner = this.db.prepare('SELECT run_id FROM fusion_agents WHERE agent_id = ?').get(agentId)?.run_id
      if (storedOwner !== undefined && storedOwner !== run.id) conflict(`agent identity already owned by run ${storedOwner}`)
      agents.run(agentId, run.id, 'unspecified', 'unassigned', run.currentGenerationIds[agentId] ?? null)
    }
    const generations = this.db.prepare(`INSERT INTO fusion_generations (id,agent_id,native_session_id,epoch,provider,model,capability_digest,status)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status`)
    for (const gen of Object.values(state.generations)) {
      generations.run(gen.id, gen.agentId, gen.sessionId, gen.epoch, gen.route.provider, gen.route.model, gen.route.capabilityDigest, gen.status)
    }
    const effects = this.db.prepare(`INSERT INTO fusion_effects (effect_id,run_id,generation_id,tool_call_id,fingerprint,state,receipt_ref,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(effect_id) DO UPDATE SET state=excluded.state,receipt_ref=excluded.receipt_ref`)
    for (const effect of Object.values(state.effects)) {
      effects.run(effect.effectId, effect.runId, effect.generationId, effect.toolCallId, effect.fingerprint,
        effect.state, effect.receiptRef ?? null, effect.idempotencyKey)
    }
    const transitions = this.db.prepare(`INSERT INTO fusion_transitions (id, run_id, agent_id, from_gen, to_gen, phase, expected_revision, error, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET from_gen=excluded.from_gen,to_gen=excluded.to_gen,phase=excluded.phase,error=excluded.error,updated_at=excluded.updated_at`)
    const generationExists = this.db.prepare('SELECT 1 FROM fusion_generations WHERE id = ?')
    for (const transition of Object.values(state.transitions)) {
      // The replacement generation may not exist yet at CHECKPOINTED time; the FK on to_gen is
      // satisfied with NULL until the prepare step projects it (later appends backfill the id).
      const toGen = generationExists.get(transition.toGenerationId) !== undefined ? transition.toGenerationId : null
      transitions.run(transition.transitionId, transition.runId, transition.agentId, transition.fromGenerationId,
        toGen, transition.phase, transition.expectedRevision, transition.error ?? null, Date.now(), Date.now())
    }
  }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true } }
}
export function openRunManager(filename: string): RunManager { return new RunManager(filename) }
