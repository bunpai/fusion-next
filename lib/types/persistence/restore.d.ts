export interface FusionBackupReference {
    readonly path: string;
    readonly sha256: string;
}
export interface FusionRestoreOptions {
    /** Operator confirms services stopped and ALL database connections closed, including other processes. */
    readonly confirmOfflineExclusive?: boolean;
}
export interface FusionRestoreResult {
    readonly restored: true;
    readonly v2Snapshot: FusionBackupReference;
}
/**
 * DESTRUCTIVE OFFLINE ROLLBACK. Caller MUST stop application/services and close all
 * SQLite handles across processes; this API cannot prove operator-enforced exclusivity.
 * Refuses visible sidecars and does not attempt to checkpoint a live WAL database.
 * Saves v2 for diagnostics before atomic same-directory rename of the verified v1 image.
 * Restore loses writes made since the v1 backup; explicit confirmation is mandatory.
 */
export declare function restoreFusionV1FromBackup(filename: string, backup: FusionBackupReference, options?: FusionRestoreOptions): FusionRestoreResult;
