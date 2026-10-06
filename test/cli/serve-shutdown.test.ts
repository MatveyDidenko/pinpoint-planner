import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from '../helpers/test-app';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const EXIT_DEADLINE_MS = 5000;
const TEST_TIMEOUT_MS = 10_000;

let proc: Bun.Subprocess | undefined;
let dir: string | undefined;

afterEach(async () => {
  proc?.kill('SIGKILL');
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

function freePort(): number {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port as number;
  probe.stop(true);
  return port;
}

test(
  'the helper process exits on shutdown while a poll and a browser stream are both open',
  async () => {
    dir = await mkdtemp(join(tmpdir(), 'pinpoint-shutdown-'));
    const port = freePort();
    const url = `http://127.0.0.1:${port}`;
    proc = Bun.spawn([process.execPath, 'bin/pinpoint.ts', 'serve', '--port', String(port), '--state-dir', dir], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    const put = await fetch(`${url}/api/plans/auth-refresh`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fixture('plan.auth-refresh'), id: 'auth-refresh' }),
    });
    expect(put.status).toBeLessThan(300);
    const poll = fetch(`${url}/api/plans/auth-refresh/poll?timeoutMs=60000`).catch(() => undefined);
    const events = await fetch(`${url}/api/plans/auth-refresh/events`);
    const health = (await (await fetch(`${url}/health`)).json()) as { busy: boolean };
    expect(health.busy).toBe(true);

    await fetch(`${url}/api/shutdown`, { method: 'POST' });

    const deadline = Bun.sleep(EXIT_DEADLINE_MS).then(() => 'still running');
    expect(await Promise.race([proc.exited, deadline])).toBe(0);
    await events.body?.cancel().catch(() => undefined);
    await poll;
  },
  TEST_TIMEOUT_MS,
);
