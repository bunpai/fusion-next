import { DatabaseSync } from 'node:sqlite';
export { restoreFusionV1FromBackup } from './restore.js';
export { FUSION_NEXT_V2_TABLES } from './schema.js';
export interface FusionMigrationResult {
    readonly migrated: boolean;
    readonly version: 2;
    readonly backup?: {
        readonly path: string;
        readonly sha256: string;
    };
}
export interface FusionMigrationOptions {
    readonly beforeCommit?: () => void;
}
/** Explicit one-time v1→v2 migration; never called implicitly by legacy SqliteFusionStore. */
export declare function migrateFusionV2(filename: string, options?: FusionMigrationOptions): FusionMigrationResult;
/** B03 can use this single connection for its own BEGIN IMMEDIATE state + outbox transactions. */
export declare function openFusionV2(filename: string): DatabaseSync;
