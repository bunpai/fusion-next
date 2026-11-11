import { describe, expect, it } from 'vitest'
import { SETTINGS_PAGES, validateSettings, assertSettingsAccess, defaultSettings } from '../src/settings/index.js'

const valid = () => defaultSettings()

describe('K01 settings schema, validation and permission matrix', () => {
  it('accepts the default configuration and reports the five main pages', () => {
    expect(SETTINGS_PAGES).toEqual(['overview', 'model-pair', 'routing-policy', 'execution', 'analytics'])
    const result = validateSettings(valid())
    expect(result).toEqual({ ok: true, value: valid() })
  })

  it('rejects unknown pages and non-object input (fail closed)', () => {
    expect(() => validateSettings({ pages: ['overview', 'secret-page'] })).toThrow(/SETTINGS_INVALID/)
    expect(() => validateSettings('not-an-object')).toThrow(/SETTINGS_INVALID/)
    expect(() => validateSettings(null)).toThrow(/SETTINGS_INVALID/)
  })

  it('requires model-pair routes with digests and distinct fallback', () => {
    const broken = valid()
    broken.modelPair.fallback = { ...broken.modelPair.primary }
    expect(() => validateSettings(broken)).toThrow(/fallback must differ from the primary pair/)
    const noDigest = valid()
    noDigest.modelPair.primary.capabilityDigest = ''
    expect(() => validateSettings(noDigest)).toThrow(/capabilityDigest/)
  })

  it('bounds routing policy numbers and validates the compaction/keepalive invariants', () => {
    const broken = valid()
    broken.routing.compactAboveRatio = 1.5
    expect(() => validateSettings(broken)).toThrow(/compactAboveRatio/)
    const keepalive = valid()
    keepalive.routing.cacheSavingsRatio = 0
    expect(() => validateSettings(keepalive)).toThrow(/cacheSavingsRatio/)
    const tiers = valid()
    tiers.routing.allowedTiers = ['L9' as never]
    expect(() => validateSettings(tiers)).toThrow(/allowedTiers/)
  })

  it('keeps approval requirements inside the execution tool scope', () => {
    const broken = valid()
    broken.execution.approvalRequired = ['shell.run', 'net.fetch']
    expect(() => validateSettings(broken)).toThrow(/approval requirement .* outside tool scope/)
    const emptyScope = valid()
    emptyScope.execution.toolScope = []
    expect(() => validateSettings(emptyScope)).toThrow(/tool scope/)
  })

  it('requires positive budget caps and non-negative analytics thresholds', () => {
    const broken = valid()
    broken.execution.hardCostMicros = 0
    expect(() => validateSettings(broken)).toThrow(/hardCostMicros/)
    const samples = valid()
    samples.analytics.minSamples = 0
    expect(() => validateSettings(samples)).toThrow(/minSamples/)
  })

  it('enforces the role matrix: only the lead edits, others view scoped pages', () => {
    expect(assertSettingsAccess('lead', 'routing-policy', 'edit')).toBe(true)
    expect(() => assertSettingsAccess('worker', 'routing-policy', 'edit')).toThrow(/SETTINGS_PERMISSION_DENIED/)
    expect(assertSettingsAccess('reviewer', 'analytics', 'view')).toBe(true)
    expect(() => assertSettingsAccess('sidekick', 'analytics', 'edit')).toThrow(/SETTINGS_PERMISSION_DENIED/)
    expect(() => assertSettingsAccess('worker', 'analytics', 'view')).toThrow(/SETTINGS_PERMISSION_DENIED/)
  })
})
