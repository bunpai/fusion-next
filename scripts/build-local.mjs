#!/usr/bin/env node
// Local bundle build — reproduces the two publish artifacts (lib/fusion-next.js,
// lib/client.js) without a full Harness checkout (which only adds tsdown + the
// internal externalClientBundle adapter). Rolldown is resolved from the pnpm
// virtual store already used by vitest. When a DSHX_HARNESS checkout is
// available, prefer: DSHX_HARNESS=/path pnpm run build.
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function loadRolldown() {
  try { return await import('rolldown') } catch {}
  const realModules = resolve(root, 'node_modules')
  const candidates = globSync('rolldown@*/node_modules/rolldown/dist/index.mjs', { cwd: resolve(realModules, '.pnpm') })
    .map(p => resolve(realModules, '.pnpm', p))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return import(pathToFileURL(candidate).href)
  }
  throw new Error('rolldown not found — run pnpm install first (it ships with vitest/vite).')
}
const { build } = await loadRolldown()

// 1. Type declarations (same step as scripts/build.mjs)
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' })
mkdirSync(resolve(root, 'lib'), { recursive: true })

// 2. Node entry: single-file ESM bundle; every bare specifier stays external
//    (matches the published lib/fusion-next.js — @deepseek-ai/* and node:* imports preserved).
await build({
  input: { 'fusion-next': resolve(root, 'src/fusion-next.ts') },
  external: /^(@deepseek-ai\/|node:)/,
  platform: 'node',
  output: {
    dir: resolve(root, 'lib'),
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    sourcemap: true,
  },
})

// 3. Client entry: CJS body wrapped in the Harness __ModuleLoader__ factory.
const tmpDir = resolve(root, '.build-tmp')
mkdirSync(tmpDir, { recursive: true })
await build({
  input: { client: resolve(root, 'src/client/index.ts') },
  external: ['react', 'react/jsx-runtime', /^@deepseek-ai\//],
  platform: 'browser',
  transform: { jsx: 'react-jsx' },
  output: {
    dir: tmpDir,
    format: 'cjs',
    entryFileNames: '[name].cjs',
    sourcemap: false,
  },
})
let body = readFileSync(resolve(tmpDir, 'client.cjs'), 'utf8')
body = body
  .replace(/^'use strict';\s*/m, '')
  .replace(/^"use strict";\s*/m, '')
  .replace(/^\s*Object\.defineProperty\(exports, Symbol\.toStringTag[^\n]*\n/m, '')
  .replace(/\/\/# sourceMappingURL=[^\n]*\s*$/, '')
const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: "fusion-next",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  body.split('\n').map(line => (line ? '\t\t' + line : line)).join('\n'),
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')
writeFileSync(resolve(root, 'lib/client.js'), wrapped)
rmSync(tmpDir, { recursive: true, force: true })
console.log('build-local: wrote lib/fusion-next.js and lib/client.js')
