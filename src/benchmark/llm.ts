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
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: Array<'text' | 'image'>
  reasoningEfforts?: Record<string, string | null>
}

export interface DshProviderConfig {
  providerId: string
  baseURL: string
  apiKeyEnv: string
  api: 'openai-responses'
  models: DshModelInfo[]
}

export const CPA_PROVIDER_CONFIG: DshProviderConfig = {
  providerId: 'cpa',
  baseURL: 'https://ai.8823823.xyz/v1',
  apiKeyEnv: 'CPA_API_KEY',
  api: 'openai-responses',
  models: [
    { id: 'deepseek-flash', name: 'deepseek-flash' },
    { id: 'gpt-5.6-terra', name: 'gpt-5.6-terra' },
    { id: 'gemini-3.8-flash-high', name: 'gemini-3.8-flash-high' },
    { id: 'gpt-5.6-luna', name: 'gpt-5.6-luna' },
    { id: 'glm-5.3', name: 'glm-5.3' },
    {
      id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash',
      contextWindow: 400000, maxTokens: 256000, input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    },
    { id: 'muse-spark-1.3-contributor', name: 'muse-spark-1.3-contributor' },
    {
      id: 'glm-5.3-flash', name: 'glm-5.3-flash',
      contextWindow: 400000, maxTokens: 128000, input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    },
    { id: 'minimax-m3', name: 'minimax-m3' },
    { id: 'mimo-v2.6-pro', name: 'mimo-v2.6-pro' },
    { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
    { id: 'claude-opus-4-6-thinking', name: 'claude-opus-4-6-thinking' },
    { id: 'jev-1.13-free', name: 'jev-1.13-free' },
    { id: 'gpt-6-chat-thinking', name: 'gpt-6-chat-thinking' },
    { id: 'gpt-6.1-terra', name: 'gpt-6.1-terra' },
    { id: 'gpt-6-luna(max)', name: 'gpt-6-luna', input: ['text', 'image'] },
    {
      id: 'gemini-4-argon-high', name: 'gemini-4-argon-high',
      contextWindow: 400000, maxTokens: 128000, input: ['text', 'image'],
    },
    { id: 'devin/swe-2-lightning', name: 'devin/swe-2-lightning' },
    { id: 'devin/swe-2-flash', name: 'devin/swe-2-flash' },
    { id: 'devin/swe-1-6', name: 'devin/swe-1-6' },
    { id: 'devin/swe-1-7', name: 'devin/swe-1-7' },
    { id: 'devin/swe-2', name: 'devin/swe-2' },
    { id: 'devin/swe-1-6-slow', name: 'devin/swe-1-6-slow' },
  ],
}

export interface BenchmarkUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

export interface LlmCallResult {
  modelId: string
  outputText: string
  usage: BenchmarkUsage
  latencyMs: number
}

export type ResponsesInput = string | Array<Record<string, unknown>>

export interface RespondRequest {
  input: ResponsesInput
  instructions?: string
  maxOutputTokens?: number
  effort?: 'off' | 'low' | 'medium' | 'high'
  timeoutMs?: number
}

interface ResponsesPayload {
  output_text?: unknown
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  usage?: {
    input_tokens?: unknown
    output_tokens?: unknown
    input_tokens_details?: { cached_tokens?: unknown }
  }
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function extractText(payload: ResponsesPayload): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const parts: string[] = []
  for (const item of payload.output ?? []) {
    for (const block of item.content ?? []) {
      if (typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('')
}

export class DshLlmClient {
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly config: DshProviderConfig, options: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
    const resolved = options.apiKey ?? (typeof process !== 'undefined' ? process.env[config.apiKeyEnv] : undefined)
    if (typeof resolved !== 'string' || resolved.length < 8) {
      throw new Error(`CPA_KEY_UNAVAILABLE: env ${config.apiKeyEnv} is not set; benchmark model calls require the DSH host environment for provider ${config.providerId}`)
    }
    this.apiKey = resolved
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  modelIds(): string[] {
    return this.config.models.map((model) => model.id)
  }

  modelInfo(modelId: string): DshModelInfo | undefined {
    return this.config.models.find((model) => model.id === modelId)
  }

  async respond(modelId: string, request: RespondRequest): Promise<LlmCallResult> {
    const model = this.modelInfo(modelId)
    if (!model) throw new Error(`BENCHMARK_MODEL_UNKNOWN: ${modelId} is not declared by provider ${this.config.providerId}`)
    const body: Record<string, unknown> = { model: modelId, input: request.input }
    if (request.instructions !== undefined) body.instructions = request.instructions
    const maxTokens = request.maxOutputTokens ?? model.maxTokens
    if (maxTokens !== undefined) body.max_output_tokens = maxTokens
    if (request.effort !== undefined) {
      const mapped = model.reasoningEfforts ? model.reasoningEfforts[request.effort] : undefined
      if (mapped === undefined) throw new Error(`BENCHMARK_EFFORT_UNSUPPORTED: model ${modelId} does not declare effort ${request.effort}`)
      if (mapped !== null) body.reasoning = { effort: mapped }
    }
    const started = performance.now()
    const response = await this.fetchImpl(`${this.config.baseURL}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: request.timeoutMs !== undefined ? AbortSignal.timeout(request.timeoutMs) : undefined,
    })
    const latencyMs = performance.now() - started
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`BENCHMARK_HTTP_${response.status}: provider ${this.config.providerId} model ${modelId} failed (${latencyMs.toFixed(0)}ms) ${detail.slice(0, 300)}`)
    }
    const payload = (await response.json()) as ResponsesPayload
    const usage = payload.usage
    return {
      modelId,
      outputText: extractText(payload),
      usage: {
        inputTokens: asCount(usage?.input_tokens),
        outputTokens: asCount(usage?.output_tokens),
        cachedInputTokens: asCount(usage?.input_tokens_details?.cached_tokens),
      },
      latencyMs,
    }
  }
}
