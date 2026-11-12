import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export * from './index.js';
export declare const name = "fusion-next";
export declare const inject: string[];
export interface Config {
    profilePath?: string;
    authorizationPath?: string;
    databasePath?: string;
    workerTools?: string[];
    lifecycleBridge?: boolean;
    hostSdkVersion?: string;
    fusionDatabasePath?: string;
    leadSandbox?: boolean;
    workerPolicy?: 'inherit' | 'restricted';
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config?: Config): Promise<void>;
