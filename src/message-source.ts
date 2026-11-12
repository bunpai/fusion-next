import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:fusion-next': { kind: 'plugin:fusion-next' } & ContextFormed
  }
}
