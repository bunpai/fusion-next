import { describe, expect, it } from 'vitest'
import { FUSION_PROVIDER, FusionCatalogAdapter, FUSION_MODEL } from '../src/host/native-selection.js'
import { savedLeadRoute } from '../src/host/settings.js'

describe('FusionCatalogAdapter input modalities', () => {
  it('hides the pseudo-model from the catalog while still resolving it for legacy selections', async () => {
    const unconfigured = new FusionCatalogAdapter()
    expect(await unconfigured.listModels(FUSION_PROVIDER)).toEqual([])
    const resolved = await unconfigured.resolveModel(FUSION_PROVIDER, FUSION_MODEL)
    expect(resolved).toMatchObject({ id: FUSION_MODEL, inputModalities: ['text'] })
  })

  it('admits exactly what the configured Lead admits, unioned with text', async () => {
    const imageLead = new FusionCatalogAdapter(async () => ['image', 'text'])
    const imageResolved = await imageLead.resolveModel(FUSION_PROVIDER, FUSION_MODEL)
    expect(imageResolved).toMatchObject({ inputModalities: ['text', 'image'] })
    const textLead = new FusionCatalogAdapter(async () => ['text'])
    const textResolved = await textLead.resolveModel(FUSION_PROVIDER, FUSION_MODEL)
    expect(textResolved).toMatchObject({ inputModalities: ['text'] })
  })

  it('resolves the exact Fusion selection through the same declaration', async () => {
    const adapter = new FusionCatalogAdapter(async () => ['image'])
    const resolved = await adapter.resolveModel(FUSION_PROVIDER, FUSION_MODEL)
    expect(resolved).toMatchObject({ provider: FUSION_PROVIDER, id: FUSION_MODEL, inputModalities: ['text', 'image'] })
    await expect(adapter.resolveModel(FUSION_PROVIDER, 'other')).rejects.toThrow('Unknown local Fusion selection')
  })
})

describe('savedLeadRoute', () => {
  it('extracts the saved Lead route and rejects unconfigured or self-referential values', () => {
    expect(savedLeadRoute({ lead: { provider: 'llm-deepseek', model: 'deepseek-chat' } })).toEqual({ provider: 'llm-deepseek', model: 'deepseek-chat' })
    expect(savedLeadRoute(undefined)).toBeUndefined()
    expect(savedLeadRoute({})).toBeUndefined()
    expect(savedLeadRoute({ lead: { provider: 'llm-deepseek' } })).toBeUndefined()
    expect(savedLeadRoute({ lead: { provider: FUSION_PROVIDER, model: FUSION_MODEL } })).toBeUndefined()
  })
})
