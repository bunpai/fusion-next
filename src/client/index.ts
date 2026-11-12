import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { FusionSettings } from './FusionSettings.js'
import { FusionHint } from './FusionHint.js'
import { FusionPairPicker } from './FusionPairPicker.js'
import { FusionTool, fusionControlTools } from './FusionTool.js'
import { FusionConsole } from './FusionConsole.js'
import { FusionNextIcon, FusionPanel } from './FusionPanel.js'
import { bindLocale } from './i18n.js'

export const name = 'fusion-next/client'
export const inject = ['slots']

export function apply(ctx: Context): void {
  // Follow DSH's language setting (Chinese or English) when the locale service is present.
  ctx.inject(['locale'], scope => { scope.effect(() => bindLocale((scope as unknown as { locale: Parameters<typeof bindLocale>[0] }).locale)) })
  for (const tool of fusionControlTools) ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: tool,
  }, FusionTool))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'fusion-next', order: 18, label: () => 'Fusion Next', inject: () => ({}),
  }, FusionSettings))
  // Session console in the conversation View row; props carry the sessionId.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'fusion-next', order: 30, label: () => 'Fusion Next', inject: () => ({}),
  }, FusionConsole))
  // Global console: sidebar icon selects the keyed main panel.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'fusion-next', order: 40, label: () => 'Fusion Next', inject: () => ({}),
  }, FusionNextIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'fusion-next', inject: () => ({}),
  }, FusionPanel))
  ctx.inject(['modelDirectories'], scope => {
    const directoryInject = (sessionId: Parameters<typeof scope.modelDirectories.directoryFor>[0]) => {
      const directory = scope.modelDirectories.directoryFor(sessionId)
      return { sessionId, directory: directory.store, load: () => { void directory.load().catch(() => undefined) } }
    }
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock', id: 'fusion-next-pair-picker', order: 19,
      inject: directoryInject,
    }, FusionPairPicker))
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock', id: 'fusion-next-configuration', order: 20,
      inject: directoryInject,
    }, FusionHint))
  })
}
