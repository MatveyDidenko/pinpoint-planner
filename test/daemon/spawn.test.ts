import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnDaemon } from '../../src/cli/daemon';
import { configFrom } from '../../src/cli/io';

const TEST_TIMEOUT_MS = 15_000;
const WAIT_DEADLINE_MS = 5000;
const HEALTH_TICK_MS = 50;
const EXIT_TICK_MS = 25;
const HELPER_IDLE_MS = 3000;
const ERROR_LINE = /^\d{4}-\d\d-\d\dT[\d:.]+Z pinpoint helper error:/m;

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = probe.port;
  await probe.stop(true);
  if (port === undefined) throw new Error('probe server reported no port');
  return port;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pollUntil(label: string, tickMs: number, check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(tickMs);
  }
  throw new Error(`timed out after ${WAIT_DEADLINE_MS}ms waiting for ${label}`);
}

function configFor(port: number, stateDir: string) {
  return configFrom({
    PINPOINT_PORT: String(port),
    PINPOINT_STATE_DIR: stateDir,
    PINPOINT_IDLE_TIMEOUT_MS: String(HELPER_IDLE_MS),
  });
}

function killQuietly(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}

describe('spawnDaemon', () => {
  it(
    'spawnDaemon starts a helper that answers /health and exits on shutdown with a log free of Error:',
    async () => {
      const stateDir = await mkdtemp(join(tmpdir(), 'pinpoint-spawn-'));
      const port = await freePort();
      let pid: number | undefined;
      try {
        pid = spawnDaemon(configFor(port, stateDir));
        expect(pid).toBeNumber();
        const base = `http://127.0.0.1:${port}`;
        let health: { app?: string } = {};
        await pollUntil('/health to answer', HEALTH_TICK_MS, async () => {
          try {
            health = (await (await fetch(`${base}/health`)).json()) as { app?: string };
            return true;
          } catch {
            return false;
          }
        });
        expect(health.app).toBe('pinpoint');

        const shutdown = await fetch(`${base}/api/shutdown`, { method: 'POST' });
        expect(shutdown.status).toBe(200);
        await pollUntil('the helper to exit', EXIT_TICK_MS, () => !isAlive(pid as number));

        const log = await readFile(join(stateDir, 'helper.log'), 'utf8');
        expect(log).toContain('listening');
        expect(log).toContain('stopped');
        expect(log).not.toContain('Error:');
      } finally {
        killQuietly(pid);
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a helper started on an occupied port writes a timestamped error line and exits non-zero',
    async () => {
      const stateDir = await mkdtemp(join(tmpdir(), 'pinpoint-spawn-'));
      const blocker = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
      let pid: number | undefined;
      try {
        pid = spawnDaemon(configFor(blocker.port as number, stateDir));
        expect(pid).toBeNumber();
        await pollUntil('the helper to exit', EXIT_TICK_MS, () => !isAlive(pid as number));

        const log = await readFile(join(stateDir, 'helper.log'), 'utf8');
        expect(log).toMatch(ERROR_LINE);
        expect(log).not.toContain('listening');
      } finally {
        killQuietly(pid);
        await blocker.stop(true);
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
