// Local client-bundle rebuild without the dshx adapter: esbuild CJS + the
// Host's window.__ModuleLoader__ factory wrapper. Externals resolve through
// the factory's require() at runtime (react + @deepseek-ai client packages
// are supplied by the Host's module loader).
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostRoot = process.env.DSHX_HARNESS ?? resolve(process.env.HOME, 'dsh/releases/0.1.6-alpha.2')
const require = createRequire(resolve(hostRoot, 'package.json'))
let esbuildPath
try { esbuildPath = require.resolve('esbuild') } catch {
  // esbuild is a transitive pnpm dep, not a root dep: resolve through the store.
  const { readdirSync } = await import('node:fs')
  const store = resolve(hostRoot, 'node_modules/.pnpm')
  const dir = readdirSync(store).filter(name => name.startsWith('esbuild@')).sort().pop()
  if (!dir) throw new Error(`esbuild not resolvable under ${hostRoot}`)
  esbuildPath = require.resolve('esbuild', { paths: [resolve(store, dir, 'node_modules')] })
}
const esbuild = await import(pathToFileURL(esbuildPath).href)
const out = resolve(root, 'lib/_client.bundle.cjs')
await esbuild.build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  jsx: 'automatic',
  sourcemap: true,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
  outfile: out,
})
const bundle = readFileSync(out, 'utf8')
const map = readFileSync(`${out}.map`, 'utf8')
const wrapped = `window.__ModuleLoader__.load({
\tid: "dsh-model-fusion",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${bundle.replace(/\n\/\/# sourceMappingURL=.*$/s, '')}
\t\treturn module.exports;
\t}
});

//# sourceMappingURL=client.js.map`
writeFileSync(resolve(root, 'lib/client.js'), wrapped)
writeFileSync(resolve(root, 'lib/client.js.map'), map)
const { rmSync } = await import('node:fs')
rmSync(out, { force: true }); rmSync(`${out}.map`, { force: true })
console.log(`[build-client-local] lib/client.js written (${wrapped.length} bytes)`)
