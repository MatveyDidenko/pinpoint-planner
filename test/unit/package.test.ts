import { describe, expect, test } from 'bun:test';
import pkg from '../../package.json';

const EXPECTED_SCRIPTS = {
  dev: 'bun --watch bin/pinpoint.ts serve',
  demo: 'bun bin/pinpoint.ts open test/fixtures/plan.auth-refresh.json',
  'demo:agent': 'bun scripts/demo-agent.ts',
  test: 'bun test',
  'test:unit': 'bun test test/unit',
  'test:http': 'bun test test/http',
  'test:cli': 'bun test test/cli',
  'test:daemon': 'bun test test/daemon',
  'test:e2e': 'playwright test',
  'setup:e2e': 'bunx playwright install chromium',
  'test:coverage': 'bun test --coverage',
  check: 'biome check .',
  'check:fix': 'biome check --write .',
  typecheck: 'tsc --noEmit',
  'build:skill': 'bun bin/pinpoint.ts skill',
  verify:
    'bun run check && bun run typecheck && bun run test:coverage && bun run build:skill -- --check && bun run test:e2e',
};

describe('package.json', () => {
  test('verify script runs check, typecheck, coverage, skill check and e2e in order', () => {
    expect(pkg.scripts.verify).toBe(EXPECTED_SCRIPTS.verify);
    for (const [name, command] of Object.entries(EXPECTED_SCRIPTS)) {
      expect(pkg.scripts[name as keyof typeof pkg.scripts]).toBe(command);
    }
  });

  test('runtime dependencies are exactly hono, zod and the three fontsource packages', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@fontsource/ibm-plex-mono',
      '@fontsource/ibm-plex-sans',
      '@fontsource/source-serif-4',
      'hono',
      'zod',
    ]);
  });
});
