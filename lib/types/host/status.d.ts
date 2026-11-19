import type { SqliteFusionStore } from '../task/sqlite-store.js';
import type { FusionStatus } from '../status.js';
import { type RuntimeV3 } from './runtime-v3.js';
/** Stage projection off the v3 runtime doc — no task reducer involved. */
export declare function runtimeStage(runtime: RuntimeV3 | undefined): Pick<NonNullable<FusionStatus['task']>, 'stage' | 'detail' | 'attention'>;
/** Reads existing durable facts only. Polling never constructs a runtime or calls a model. */
export declare function readFusionStatus(store: SqliteFusionStore, sessionId: string): FusionStatus;
export declare function readFusionStatusAsync(store: SqliteFusionStore, sessionId: string, signal?: AbortSignal): Promise<FusionStatus>;
