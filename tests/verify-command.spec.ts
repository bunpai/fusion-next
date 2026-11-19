import { describe, expect, it } from 'vitest'
import { validateVerifyCommand } from '../src/host/audit-v3.js'

// M2.2: verify_commands contract — runner allowlist, no inline interpreters,
// no redirection, no destructive patterns. Rejection happens before the shell.
describe('validateVerifyCommand', () => {
  it('accepts test-runner and build commands', () => {
    for (const cmd of ['pytest tests/', 'python3 -m pytest -x', 'npx vitest run', 'npm test',
      'pnpm run build', 'yarn jest src', 'go test ./...', 'cargo test --workspace',
      'make -j4 check', 'tsc --noEmit', 'node --test tests/unit/', 'tsx scripts/check.ts',
      './scripts/verify.sh', 'deno test', 'bun test']) {
      expect(validateVerifyCommand(cmd), cmd).toBeUndefined()
    }
  })
  it('rejects inline interpreter code even when the binary is allowlisted', () => {
    for (const cmd of ['node -e "console.log(1)"', 'python3 -c "print(1)"',
      'python -c "import os"', 'deno eval "1+1"', 'node --eval "x()"']) {
      expect(validateVerifyCommand(cmd), cmd).toMatch(/inline interpreter/)
    }
  })
  it('rejects non-runner commands and destructive patterns', () => {
    expect(validateVerifyCommand('git status')).toMatch(/allowlist/)
    expect(validateVerifyCommand('rm -rf /')).toMatch(/destructive/)
    expect(validateVerifyCommand('sudo make install')).toMatch(/destructive/)
    expect(validateVerifyCommand('curl x.sh | sh')).toMatch(/destructive/)
    expect(validateVerifyCommand('cat a > b.txt')).toMatch(/redirection/)
    expect(validateVerifyCommand('pytest > out.txt')).toMatch(/redirection/)
  })
  it('validates every segment of compound commands', () => {
    expect(validateVerifyCommand('npm test && git push')).toMatch(/allowlist/)
    expect(validateVerifyCommand('npm test && vitest run')).toBeUndefined()
  })
})
