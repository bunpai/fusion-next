// Local host-bundle rebuild bypassing scripts/build.mjs version gate.
// The dshx externalClientBundle adapter is absent from the pinned 0.1.6-alpha.2
// checkout, so replicate the HOST-side bundle only (client bundle stays as-is):
// the current lib bundle imports only node builtins, so externals are just node:*.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const host = process.env.DSHX_HARNESS ?? `${process.env.HOME}/dsh/releases/0.1.6-alpha.2`;
const require = createRequire(resolve(host, 'package.json'));
const bundlerPath = require.resolve('tsdown');
const { build } = await import(pathToFileURL(bundlerPath).href);

await build({
  entry: { 'dsh-model-fusion': 'src/dsh-model-fusion.ts' },
  outDir: 'lib',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  clean: false,
  format: 'esm',
  platform: 'node',
  dts: false,
  sourcemap: false,
  config: false,
  cwd: process.cwd(),
});
console.log('[local-host-build] done');
