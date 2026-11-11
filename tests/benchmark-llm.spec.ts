import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CPA_PROVIDER_CONFIG, DshLlmClient, type LlmCallResult } from '../src/benchmark/llm.js'
import { BudgetService, type PriceTable } from '../src/budget/index.js'
import { migrateFusionV2 } from '../src/persistence/index.js'
import { openRunManager } from '../src/run-manager/index.js'
import { FusionRunId, SessionAliasId } from '../src/lifecycle/index.js'

const dirs: string[] = []
const path = () => { const dir = mkdtempSync(join(tmpdir(), 'fusion-bench-llm-')); dirs.push(dir); return join(dir, 'fusion.db') }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const okResponse = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  output_text: 'ok',
  usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 4 } },
  ...overrides,
}), { status: 200 })

describe('benchmark LLM transport reusing the DSH provider table', () => {
  it('refuses to run without the host-provided key and never guesses one', () => {
    const previous = process.env.CPA_API_KEY
    delete process.env.CPA_API_KEY
    try {
      expect(() => new DshLlmClient(CPA_PROVIDER_CONFIG)).toThrow(/CPA_KEY_UNAVAILABLE.*CPA_API_KEY/)
    } finally {
      if (previous !== undefined) process.env.CPA_API_KEY = previous
    }
  })

  it('posts openai-responses requests with the mirrored provider table', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const client = new DshLlmClient(CPA_PROVIDER_CONFIG, {
      apiKey: 'sk-benchmark-test-key-0001',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} })
        return okResponse()
      }) as typeof fetch,
    })
    expect(client.modelIds()).toContain('deepseek-v4.1-flash')
    expect(client.modelInfo('deepseek-v4.1-flash')?.contextWindow).toBe(400000)
    const result = await client.respond('deepseek-v4.1-flash', { input: 'ping', instructions: 'reply ok', maxOutputTokens: 64, effort: 'medium', timeoutMs: 5_000 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://ai.8823823.xyz/v1/responses')
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(body.model).toBe('deepseek-v4.1-flash')
    expect(body.max_output_tokens).toBe(64)
    expect((body.reasoning as Record<string, unknown>).effort).toBe('medium')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-benchmark-test-key-0001')
    expect(result.outputText).toBe('ok')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 4 })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('maps unknown effort levels to a fail-closed error for the specific model', async () => {
    const client = new DshLlmClient(CPA_PROVIDER_CONFIG, {
      apiKey: 'sk-benchmark-test-key-0001',
      fetchImpl: (async () => okResponse()) as typeof fetch,
    })
    await expect(client.respond('deepseek-flash', { input: 'ping', effort: 'high' })).rejects.toThrow(/BENCHMARK_EFFORT_UNSUPPORTED.*deepseek-flash/)
    await expect(client.respond('no-such-model', { input: 'ping' })).rejects.toThrow(/BENCHMARK_MODEL_UNKNOWN/)
  })

  it('surfaces provider failures with status so fault injection can classify them', async () => {
    const client = new DshLlmClient(CPA_PROVIDER_CONFIG, {
      apiKey: 'sk-benchmark-test-key-0001',
      fetchImpl: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
    })
    await expect(client.respond('glm-5.3', { input: 'ping' })).rejects.toThrow(/BENCHMARK_HTTP_429/)
  })

  it('feeds measured usage into the budget estimator with the unpriced guard', () => {
    const file = path()
    migrateFusionV2(file)
    const manager = openRunManager(file)
    const run = FusionRunId('run-1')
    const session = SessionAliasId('session-1')
    manager.append({ schemaVersion: 1, eventId: 'seed-created', type: 'RUN_CREATED', runId: run, hostSessionId: session, taskId: 'task-1', budgetId: 'budget-1', mode: 'DIRECT', branchId: 'root' } as never, 0)
    const prices: PriceTable = { priceOf: (route) => (route.provider === 'cpa' ? { inputMicrosPerToken: 10, outputMicrosPerToken: 20, priceVersion: 'benchmark-local-estimate' } : undefined) }
    const budgets = new BudgetService(manager, prices)
    budgets.reserve(run, 'budget-1', 1_000_000)
    const result: LlmCallResult = {
      modelId: 'glm-5.3', outputText: 'ok',
      usage: { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 400 },
      latencyMs: 120,
    }
    const estimate = budgets.estimate({ provider: 'cpa', model: result.modelId, capabilityDigest: 'd' }, {
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cacheReadTokens: result.usage.cachedInputTokens,
    })
    expect(estimate).toEqual({ priced: true, costMicros: 1000 * 10 + 500 * 20, priceVersion: 'benchmark-local-estimate' })
    const unpriced = budgets.estimate({ provider: 'other', model: 'x', capabilityDigest: 'd' }, { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 })
    expect(unpriced.priced).toBe(false)
    manager.close()
  })
})
