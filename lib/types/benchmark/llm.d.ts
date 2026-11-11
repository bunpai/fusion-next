/**
 * Benchmark LLM transport that REUSES the DSH host LLM configuration.
 *
 * The provider table below mirrors the `cpa` block of the DSH desktop profile
 * (`~/.dsh/profiles/desktop/cordis.patch.yml`, plugin `@deepseek-ai/dsh-llm-pi-ai`).
 * The profile is the source of truth; this mirror exists only so the benchmark
 * driver can be type-checked and tested outside a live host. Authentication is
 * read from the env var named by `apiKeyEnv` (never inlined, never guessed):
 * inside the real DSH host environment that variable is already provided.
 */
export interface DshModelInfo {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: Array<'text' | 'image'>;
    reasoningEfforts?: Record<string, string | null>;
}
export interface DshProviderConfig {
    providerId: string;
    baseURL: string;
    apiKeyEnv: string;
    api: 'openai-responses';
    models: DshModelInfo[];
}
export declare const CPA_PROVIDER_CONFIG: DshProviderConfig;
export interface BenchmarkUsage {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
}
export interface LlmCallResult {
    modelId: string;
    outputText: string;
    usage: BenchmarkUsage;
    latencyMs: number;
}
export type ResponsesInput = string | Array<Record<string, unknown>>;
export interface RespondRequest {
    input: ResponsesInput;
    instructions?: string;
    maxOutputTokens?: number;
    effort?: 'off' | 'low' | 'medium' | 'high';
    timeoutMs?: number;
}
export declare class DshLlmClient {
    private readonly config;
    private readonly apiKey;
    private readonly fetchImpl;
    constructor(config: DshProviderConfig, options?: {
        apiKey?: string;
        fetchImpl?: typeof fetch;
    });
    modelIds(): string[];
    modelInfo(modelId: string): DshModelInfo | undefined;
    respond(modelId: string, request: RespondRequest): Promise<LlmCallResult>;
}
