import type { ModelRoute } from '../lifecycle/index.js'
import type { RouteCapabilityRegistry } from '../generation/service.js'
import { validateSettings, type SettingsSchema } from '../settings/index.js'

/** L01 compatibility layer for the v1 upgrade: legacy menu models, the old settings entry point
 * and legacy session bindings.
 *
 * Data compatibility (lossless v1→v2 migration and the guarded rollback path) lives in the
 * persistence epic and is exercised end-to-end in tests/compat.spec.ts. Dual-version Host
 * acceptance stays BLOCKED until a real Host checkout is available; this module only implements
 * the version-independent behavior: an undeclared legacy model is refused loudly instead of
 * silently skipped, and a missing legacy binding fails closed with NEEDS_REPAIR. */

export type LegacyModelResolution =
  | { verified: true; route: ModelRoute }
  | { verified: false; reason: string }

export class LegacyCompatibility {
  /** Old model menu entries only activate when the target model is declared with a verified
   * capability digest; otherwise switching is refused (documented restricted behavior). */
  legacyModelRoute(registry: RouteCapabilityRegistry, provider: string, model: string): LegacyModelResolution {
    const known = registry.lookup(provider, model)
    if (!known) {
      return { verified: false, reason: `legacy model ${provider}/${model} is not declared in the capability registry; switching to it is refused, never silently skipped` }
    }
    return { verified: true, route: { provider, model, capabilityDigest: known.capabilityDigest } }
  }

  /** The original settings entry keeps working: legacy configs flow through the K01 schema. */
  legacySettings(raw: unknown): { ok: true; value: SettingsSchema } {
    return validateSettings(raw)
  }

  /** S18: a missing legacy binding must never fabricate a Fusion session binding. */
  assertLegacyBinding<T extends object>(binding: T | undefined, hostSessionId: string): T {
    if (!binding) {
      throw new Error(`NEEDS_REPAIR: missing legacy binding for host session ${hostSessionId}; refusing to fabricate a run`)
    }
    return binding
  }
}
