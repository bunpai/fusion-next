/** K01 settings: the five main settings pages, a validated schema and the role permission matrix.
 *
 * The schema mirrors the runtime invariants of the earlier epics (model pairs carry capability
 * digests, routing bounds match the compaction/keepalive policies, execution approval
 * requirements stay inside the tool scope, budgets are positive). Validation is fail closed:
 * unknown pages and out-of-range numbers are rejected with SETTINGS_INVALID. Only the lead role
 * may edit; budget details are view-restricted (SETTINGS_PERMISSION_DENIED otherwise). */

export const SETTINGS_PAGES = ['overview', 'model-pair', 'routing-policy', 'execution', 'analytics'] as const
export type SettingsPage = (typeof SETTINGS_PAGES)[number]
export type SettingsAction = 'view' | 'edit'
export type SettingsRoleName = 'lead' | 'sidekick' | 'worker' | 'reviewer'

export type SettingsSchema = {
  pages: readonly SettingsPage[]
  modelPair: {
    primary: { provider: string; model: string; capabilityDigest: string }
    fallback: { provider: string; model: string; capabilityDigest: string }
  }
  routing: {
    requiredTools: string[]
    minContextTokens: number
    allowedTiers: Array<'L0' | 'L1' | 'L2' | 'L3'>
    compactAboveRatio: number
    cacheSavingsRatio: number
    fallbackOrder: Array<'PRIMARY' | 'FALLBACK' | 'ANY-AVAILABLE'>
  }
  execution: {
    toolScope: string[]
    approvalRequired: string[]
    hardCostMicros: number
    maxCalls?: number
    maxRetries?: number
  }
  analytics: { minSamples: number }
}

export type SettingsRole = { name: SettingsRoleName; actions: SettingsAction[]; pages: readonly SettingsPage[] | 'all' }

const VIEW_ALL: SettingsRole[] = [
  { name: 'lead', actions: ['view', 'edit'], pages: 'all' },
  { name: 'sidekick', actions: ['view'], pages: 'all' },
  { name: 'worker', actions: ['view'], pages: ['overview', 'execution'] },
  { name: 'reviewer', actions: ['view'], pages: ['overview', 'analytics'] },
]

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sorted = (values: readonly string[]): string[] => [...values].sort()

export const defaultSettings = (): SettingsSchema => ({
  pages: SETTINGS_PAGES,
  modelPair: {
    primary: { provider: 'alpha', model: 'a1', capabilityDigest: 'digest-a' },
    fallback: { provider: 'beta', model: 'b1', capabilityDigest: 'digest-b' },
  },
  routing: {
    requiredTools: ['fs.read', 'search'],
    minContextTokens: 32_000,
    allowedTiers: ['L0', 'L1', 'L2', 'L3'],
    compactAboveRatio: 0.8,
    cacheSavingsRatio: 1.5,
    fallbackOrder: ['PRIMARY', 'FALLBACK', 'ANY-AVAILABLE'],
  },
  execution: {
    toolScope: ['fs.read', 'fs.write', 'search', 'shell.run'],
    approvalRequired: ['shell.run'],
    hardCostMicros: 5_000_000,
    maxCalls: 200,
    maxRetries: 3,
  },
  analytics: { minSamples: 5 },
})

const invalid = (reason: string): never => {
  throw new Error(`SETTINGS_INVALID: ${reason}`)
}

export function validateSettings(raw: unknown): { ok: true; value: SettingsSchema } {
  if (!isPlainObject(raw)) throw new Error('SETTINGS_INVALID: settings must be an object')
  const pages = raw['pages']
  if (!Array.isArray(pages) || pages.length !== SETTINGS_PAGES.length
    || !pages.every((page) => (SETTINGS_PAGES as readonly string[]).includes(page as string))) {
    invalid(`pages must be exactly ${SETTINGS_PAGES.join(', ')}`)
  }
  const modelPair = raw['modelPair']
  if (!isPlainObject(modelPair) || !isPlainObject(modelPair['primary']) || !isPlainObject(modelPair['fallback'])) throw new Error('SETTINGS_INVALID: model pair requires primary and fallback')
  const primary = modelPair['primary'] as Record<string, unknown>
  const fallback = modelPair['fallback'] as Record<string, unknown>
  for (const [name, leg] of [['primary', primary], ['fallback', fallback]] as const) {
    if (typeof leg['provider'] !== 'string' || leg['provider'].length === 0) invalid(`model pair ${name} provider required`)
    if (typeof leg['model'] !== 'string' || leg['model'].length === 0) invalid(`model pair ${name} model required`)
    if (typeof leg['capabilityDigest'] !== 'string' || leg['capabilityDigest'].length === 0) invalid(`model pair ${name} capabilityDigest required`)
  }
  if (primary['provider'] === fallback['provider'] && primary['model'] === fallback['model']) {
    invalid('model pair fallback must differ from the primary pair')
  }
  const routing = raw['routing']
  if (!isPlainObject(routing)) throw new Error('SETTINGS_INVALID: routing policy required')
  if (!Array.isArray(routing['requiredTools']) || routing['requiredTools'].length === 0) invalid('routing requiredTools must not be empty')
  if (typeof routing['minContextTokens'] !== 'number' || !Number.isSafeInteger(routing['minContextTokens']) || routing['minContextTokens'] <= 0) invalid('routing minContextTokens must be a positive integer')
  const tiers = routing['allowedTiers']
  if (!Array.isArray(tiers) || tiers.length === 0 || !tiers.every((tier) => ['L0', 'L1', 'L2', 'L3'].includes(tier as string))) invalid('routing allowedTiers must be a non-empty subset of L0..L3')
  if (typeof routing['compactAboveRatio'] !== 'number' || !(routing['compactAboveRatio'] > 0 && routing['compactAboveRatio'] < 1)) invalid('routing compactAboveRatio must be within (0, 1)')
  if (typeof routing['cacheSavingsRatio'] !== 'number' || !(routing['cacheSavingsRatio'] > 0)) invalid('routing cacheSavingsRatio must be positive')
  const fallbackOrder = routing['fallbackOrder']
  if (!Array.isArray(fallbackOrder) || fallbackOrder.length === 0
    || !fallbackOrder.every((step) => ['PRIMARY', 'FALLBACK', 'ANY-AVAILABLE'].includes(step as string))) invalid('routing fallbackOrder is invalid')
  const execution = raw['execution']
  if (!isPlainObject(execution)) throw new Error('SETTINGS_INVALID: execution required')
  if (!Array.isArray(execution['toolScope']) || execution['toolScope'].length === 0) invalid('execution tool scope must not be empty')
  const toolScope = sorted(execution['toolScope'] as string[])
  const approvalRequired = Array.isArray(execution['approvalRequired']) ? sorted(execution['approvalRequired'] as string[]) : []
  for (const approval of approvalRequired) {
    if (!toolScope.includes(approval)) invalid(`execution approval requirement ${approval} outside tool scope`)
  }
  if (typeof execution['hardCostMicros'] !== 'number' || !Number.isSafeInteger(execution['hardCostMicros']) || execution['hardCostMicros'] <= 0) invalid('execution hardCostMicros must be a positive integer')
  for (const key of ['maxCalls', 'maxRetries'] as const) {
    const value = execution[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) invalid(`execution ${key} must be a non-negative integer`)
  }
  const analytics = raw['analytics']
  if (!isPlainObject(analytics) || typeof analytics['minSamples'] !== 'number' || !Number.isSafeInteger(analytics['minSamples']) || analytics['minSamples'] <= 0) throw new Error('SETTINGS_INVALID: analytics minSamples must be a positive integer')
  return { ok: true, value: raw as unknown as SettingsSchema }
}

export function assertSettingsAccess(roleName: SettingsRoleName, page: SettingsPage, action: SettingsAction): boolean {
  const role = VIEW_ALL.find((candidate) => candidate.name === roleName)
  if (!role) throw new Error(`SETTINGS_PERMISSION_DENIED: unknown role ${roleName}`)
  if (!role.actions.includes(action)) throw new Error(`SETTINGS_PERMISSION_DENIED: role ${roleName} may not ${action} settings`)
  if (role.pages !== 'all' && !(role.pages as readonly string[]).includes(page)) {
    throw new Error(`SETTINGS_PERMISSION_DENIED: role ${roleName} may not access page ${page}`)
  }
  return true
}
