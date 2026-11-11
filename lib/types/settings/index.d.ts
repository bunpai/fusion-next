/** K01 settings: the five main settings pages, a validated schema and the role permission matrix.
 *
 * The schema mirrors the runtime invariants of the earlier epics (model pairs carry capability
 * digests, routing bounds match the compaction/keepalive policies, execution approval
 * requirements stay inside the tool scope, budgets are positive). Validation is fail closed:
 * unknown pages and out-of-range numbers are rejected with SETTINGS_INVALID. Only the lead role
 * may edit; budget details are view-restricted (SETTINGS_PERMISSION_DENIED otherwise). */
export declare const SETTINGS_PAGES: readonly ["overview", "model-pair", "routing-policy", "execution", "analytics"];
export type SettingsPage = (typeof SETTINGS_PAGES)[number];
export type SettingsAction = 'view' | 'edit';
export type SettingsRoleName = 'lead' | 'sidekick' | 'worker' | 'reviewer';
export type SettingsSchema = {
    pages: readonly SettingsPage[];
    modelPair: {
        primary: {
            provider: string;
            model: string;
            capabilityDigest: string;
        };
        fallback: {
            provider: string;
            model: string;
            capabilityDigest: string;
        };
    };
    routing: {
        requiredTools: string[];
        minContextTokens: number;
        allowedTiers: Array<'L0' | 'L1' | 'L2' | 'L3'>;
        compactAboveRatio: number;
        cacheSavingsRatio: number;
        fallbackOrder: Array<'PRIMARY' | 'FALLBACK' | 'ANY-AVAILABLE'>;
    };
    execution: {
        toolScope: string[];
        approvalRequired: string[];
        hardCostMicros: number;
        maxCalls?: number;
        maxRetries?: number;
    };
    analytics: {
        minSamples: number;
    };
};
export type SettingsRole = {
    name: SettingsRoleName;
    actions: SettingsAction[];
    pages: readonly SettingsPage[] | 'all';
};
export declare const defaultSettings: () => SettingsSchema;
export declare function validateSettings(raw: unknown): {
    ok: true;
    value: SettingsSchema;
};
export declare function assertSettingsAccess(roleName: SettingsRoleName, page: SettingsPage, action: SettingsAction): boolean;
