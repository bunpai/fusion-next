import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export * from './index.js';
export declare const name = "fusion-next";
export declare const inject: string[];
/**
 * v0.3.0 — single-dispatch pair. The v0.2 work-order ceremony (11 tools,
 * verbatim gating, sandbox rewriting, the B01–G03 journal) is gone: the Lead
 * calls fusion_dispatch, the executor runs uninterrupted in one settle, and a
 * deterministic audit returns a bounded bundle. Legacy config keys stay
 * accepted so existing installations keep loading; unused ones are inert.
 */
export interface Config {
    profilePath?: string;
    databasePath?: string;
    fusionDatabasePath?: string;
    authorizationPath?: string;
    lifecycleBridge?: boolean;
    hostSdkVersion?: string;
    leadSandbox?: boolean;
    workerTools?: string[];
    workerPolicy?: 'inherit' | 'restricted';
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config?: Config): Promise<void>;
