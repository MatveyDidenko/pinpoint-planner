import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STUB_ASSETS } from '../../src/server/assets';
import { type RunningServer, startServer } from '../../src/server/start';
import { fixture } from '../helpers/test-app';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SPAWN_DEADLINE_MS = 5000;

let server: RunningServer;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pinpoint-subprocess-'));
  server = await startServer({
    port: 0,
    stateDir: dir,
    assets: STUB_ASSETS,
    heartbeatMs: 5,
    browserGraceMs: 10_000,
  });
  const res = await fetch(`${server.url}/api/plans/auth-refresh`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fixture('plan.auth-refresh'), id: 'auth-refresh' }),
  });
  expect(res.status).toBeLessThan(300);
});

afterAll(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

function spawnCli(args: string[]) {
  return Bun.spawn([process.execPath, 'bin/pinpoint.ts', ...args], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PINPOINT_PORT: String(server.port), PINPOINT_STATE_DIR: dir, PINPOINT_NO_OPEN: '1' },
  });
}

async function waitUntil(pred: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + SPAWN_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (pred()) return;
    await Bun.sleep(5);
  }
  throw new Error(`waitUntil timed out: ${label}`);
}

describe('pinpoint as a real process', () => {
  it('status and poll --timeout-ms 0 print one json document and exit 0 against an in-process server', async () => {
    for (const args of [
      ['status', 'auth-refresh'],
      ['poll', 'auth-refresh', '--timeout-ms', '0'],
    ]) {
      const proc = spawnCli(args);
      const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(code).toBe(0);
      expect(stdout.endsWith('\n')).toBe(true);
      expect(stdout.trimEnd().split('\n')).toHaveLength(1);
      expect(JSON.parse(stdout)).toBeObject();
    }
  });

  it('SIGINT during a poll exits 130 with the re-run hint on stderr and empty stdout', async () => {
    const proc = spawnCli(['poll', 'auth-refresh', '--timeout-ms', '5000']);
    const stdout = new Response(proc.stdout).text();
    const stderr = new Response(proc.stderr).text();
    await waitUntil(() => server.app.polls.waiters('auth-refresh') === 1, 'the poll is parked on the helper');
    proc.kill('SIGINT');
    expect(await proc.exited).toBe(130);
    expect(await stderr).toContain('poll interrupted; nothing was lost, run the same command again\n');
    expect(await stdout).toBe('');
  });
});
