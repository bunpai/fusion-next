import { describe, expect, it } from 'vitest'
import { FUSION_NEXT_PROVIDER, FusionCatalogAdapter, FUSION_NEXT_MODEL } from '../src/host/native-selection.js'
import { savedLeadRoute } from '../src/host/settings.js'

describe('FusionCatalogAdapter input modalities', () => {
  it('hides the pseudo-model from the catalog while still resolving it for legacy selections', async () => {
    const unconfigured = new FusionCatalogAdapter()
    expect(await unconfigured.listModels(FUSION_NEXT_PROVIDER)).toEqual([])
    const resolved = await unconfigured.resolveModel(FUSION_NEXT_PROVIDER, FUSION_NEXT_MODEL)
    expect(resolved).toMatchObject({ id: FUSION_NEXT_MODEL, inputModalities: ['text'] })
  })

  it('admits exactly what the configured Lead admits, unioned with text', async () => {
    const imageLead = new FusionCatalogAdapter(async () => ({ provider: 'p', id: 'm', name: 'm', inputModalities: ['image', 'text'] }))
    const imageResolved = await imageLead.resolveModel(FUSION_NEXT_PROVIDER, FUSION_NEXT_MODEL)
    expect(imageResolved).toMatchObject({ inputModalities: ['text', 'image'] })
    const textLead = new FusionCatalogAdapter(async () => ({ provider: 'p', id: 'm', name: 'm', inputModalities: ['text'] }))
    const textResolved = await textLead.resolveModel(FUSION_NEXT_PROVIDER, FUSION_NEXT_MODEL)
    expect(textResolved).toMatchObject({ inputModalities: ['text'] })
  })

  it('mirrors the Lead context window so host compaction can size the virtual model', async () => {
    const adapter = new FusionCatalogAdapter(async () => ({ provider: 'p', id: 'm', name: 'm',
      inputModalities: ['text'], context: { contextWindow: 400_000 } as never, defaultMaxTokens: 128_000 }))
    const resolved = await adapter.resolveModel(FUSION_NEXT_PROVIDER, FUSION_NEXT_MODEL)
    expect(resolved.context?.contextWindow).toBe(400_000)
    expect(resolved.defaultMaxTokens).toBe(128_000)
    const bare = await new FusionCatalogAdapter().resolveModel(FUSION_NEXT_PROVIDER, FUSION_NEXT_MODEL)
    expect(bare.context?.contextWindow).toBe(128_000) // conservative fallback keeps model switch alive
  })

  it('resolves the exact Fusion selection through the same declaration', async () => {
    const adapter = new FusionCatalogAdapter(async () => ({ provider: 'p', id: 'm', name: 'm', inputModalities: ['image'] }))
    const resolved = await adapter.resolveModel(FUSION_NEXT_PROVIDER, FUSION_NEXT_MODEL)
    expect(resolved).toMatchObject({ provider: FUSION_NEXT_PROVIDER, id: FUSION_NEXT_MODEL, inputModalities: ['text', 'image'] })
    await expect(adapter.resolveModel(FUSION_NEXT_PROVIDER, 'other')).rejects.toThrow('Unknown local Fusion selection')
  })
})

describe('savedLeadRoute', () => {
  it('extracts the saved Lead route and rejects unconfigured or self-referential values', () => {
    expect(savedLeadRoute({ lead: { provider: 'llm-deepseek', model: 'deepseek-chat' } })).toEqual({ provider: 'llm-deepseek', model: 'deepseek-chat' })
    expect(savedLeadRoute(undefined)).toBeUndefined()
    expect(savedLeadRoute({})).toBeUndefined()
    expect(savedLeadRoute({ lead: { provider: 'llm-deepseek' } })).toBeUndefined()
    expect(savedLeadRoute({ lead: { provider: FUSION_NEXT_PROVIDER, model: FUSION_NEXT_MODEL } })).toBeUndefined()
  })
})
