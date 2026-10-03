import { describe, expect, it } from 'bun:test';
import { ensureServer } from '../../src/cli/ensure-server';
import { CliError } from '../../src/cli/errors';
import { configFrom } from '../../src/cli/io';
import { asFetch, fakeIo } from '../helpers/fake-io';

const cfg = configFrom({ PINPOINT_STATE_DIR: '/state', PINPOINT_PORT: '4800' });

const healthBody = (app: string) => ({
  ok: true,
  app,
  version: '0.1.0',
  startedAt: '2026-10-03T18:00:00.000Z',
  stateDir: '/state',
  plans: [],
  busy: false,
});

const healthy = (app = 'pinpoint'): Response => Response.json(healthBody(app));

function harness(script: Array<Response | Error>) {
  let clock = Date.parse('2026-10-03T18:00:00.000Z');
  const calls = { fetch: 0, spawn: 0, sleeps: [] as number[] };
  const io = fakeIo({
    fetch: asFetch(async () => {
      const next = script[Math.min(calls.fetch, script.length - 1)];
      if (next === undefined) throw new Error('harness: empty fetch script');
      calls.fetch += 1;
      if (next instanceof Error) throw next;
      return next.clone();
    }),
    spawnDaemon: () => {
      calls.spawn += 1;
    },
    sleep: async (ms) => {
      calls.sleeps.push(ms);
      clock += ms;
    },
    now: () => new Date(clock),
  });
  return { io, calls };
}

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected the promise to reject');
}

describe('ensureServer', () => {
  it('healthy helper means no spawn; unreachable twice then healthy spawns once', async () => {
    const running = harness([healthy()]);
    const doc = await ensureServer(running.io, cfg);
    expect(doc.app).toBe('pinpoint');
    expect(running.calls.spawn).toBe(0);
    expect(running.calls.sleeps).toEqual([]);

    const down = new Error('connection refused');
    const starting = harness([down, down, healthy()]);
    const started = await ensureServer(starting.io, cfg);
    expect(started.app).toBe('pinpoint');
    expect(starting.calls.spawn).toBe(1);
    expect(starting.calls.fetch).toBe(3);
    expect(starting.calls.sleeps).toEqual([100, 100]);
  });

  it('never healthy throws SERVER_UNREACHABLE after the deadline without real waiting', async () => {
    const { io, calls } = harness([new Error('connection refused')]);

    const error = await failure(ensureServer(io, cfg, { deadlineMs: 450 }));

    expect(error.code).toBe('SERVER_UNREACHABLE');
    expect(error.message).toBe('could not reach the helper at http://127.0.0.1:4800; see /state/helper.log');
    expect(calls.spawn).toBe(1);
    expect(calls.sleeps.reduce((a, b) => a + b, 0)).toBe(450);
  });

  it('a foreign program on the port is SERVER_UNREACHABLE without a spawn', async () => {
    const { io, calls } = harness([healthy('other')]);

    const error = await failure(ensureServer(io, cfg));

    expect(error.code).toBe('SERVER_UNREACHABLE');
    expect(error.message).toContain('another program');
    expect(error.message).toContain('4800');
    expect(calls.spawn).toBe(0);
  });

  it('a non-JSON answer on the port surfaces as IO without a spawn', async () => {
    const { io, calls } = harness([new Response('<html>nope</html>', { status: 200 })]);

    const error = await failure(ensureServer(io, cfg));

    expect(error.code).toBe('IO');
    expect(calls.spawn).toBe(0);
  });
});
