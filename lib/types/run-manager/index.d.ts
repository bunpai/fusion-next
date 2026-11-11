import { type FusionRunId, type SessionAliasId, type LifecycleEvent, type LifecycleState, type FusionRun, type SessionAlias } from '../lifecycle/index.js';
export type RunEventInput = Omit<LifecycleEvent, 'seq' | 'expectedRevision'>;
export interface AppendOptions {
    beforeCommit?: () => void;
}
export interface StoredRunEvent {
    eventId: string;
    runId: FusionRunId;
    seq: number;
    type: string;
    payload: LifecycleEvent;
}
/** Durable global sequence encoded in payload_json, independent of rowid and VACUUM. */
export interface JournalEvent extends StoredRunEvent {
    cursor: number;
}
/** One connection per manager; BEGIN IMMEDIATE serializes writes across independent managers. */
export declare class RunManager {
    private readonly db;
    private closed;
    private readonly subscribers;
    constructor(filename: string);
    /** In-process post-COMMIT notifications only; durable replay remains the event ledger. */
    subscribe(callback: (message: StoredRunEvent) => void): () => void;
    private ensureOpen;
    private events;
    private replay;
    getState(): LifecycleState;
    getRun(runId: FusionRunId): FusionRun | undefined;
    getAlias(sessionId: SessionAliasId): SessionAlias | undefined;
    listEvents(runId: FusionRunId): StoredRunEvent[];
    /** Committed journal is the durable outbox. Persist cursor externally after handling each event.
     * Consumers can replay from their last durable cursor after restart; delivery is at-least-once.
     * This cursor is the global reducer seq stored in payload, NOT SQLite rowid (VACUUM-safe).
     * subscribe() is best-effort only and must not be used for reliable delivery.
     */
    readEventsSince(cursor: number, limit?: number): JournalEvent[];
    foreignKeyViolations(): unknown[];
    /** expectedRevision is scoped to event.runId; fork parents are checked under the same writer lock. */
    append(input: RunEventInput, expectedRevision: number, options?: AppendOptions): LifecycleState;
    private persistProjection;
    close(): void;
}
export declare function openRunManager(filename: string): RunManager;
