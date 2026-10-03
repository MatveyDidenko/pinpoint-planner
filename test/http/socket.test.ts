import { afterEach, describe, expect, test } from 'bun:test';
import type { PollOutput } from '../../src/core/output';
import { STUB_ASSETS } from '../../src/server/assets';
import { type RunningServer, startServer } from '../../src/server/start';
import { ask, fixture, waitFor } from '../helpers/test-app';

const PLAN = 'auth-refresh';
const READ_GUARD_MS = 2000;
const MIN_HEARTBEAT_BYTES = 3;
const IDLE_TIMEOUT_MS = 30;
const BYTES_PAST_IDLE = 24;

let server: RunningServer;

afterEach(() => server.close());

async function put(): Promise<void> {
  const res = await fetch(`${server.url}/api/plans/${PLAN}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fixture('plan.auth-refresh'), id: PLAN }),
  });
  expect(res.status).toBeLessThan(300);
}

function openPoll(signal: AbortSignal): Promise<Response> {
  return fetch(`${server.url}/api/plans/${PLAN}/poll?timeoutMs=5000`, { signal });
}

describe('startServer on a real socket', () => {
  test('heartbeat bytes arrive on a real socket and the poll body parses after a wake', async () => {
    server = await startServer({ port: 0, stateDir: null, heartbeatMs: 5, assets: STUB_ASSETS });
    await put();
    const signal = AbortSignal.timeout(READ_GUARD_MS);
    const res = await openPoll(signal);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';

    while (text.length < MIN_HEARTBEAT_BYTES) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('poll stream ended before heartbeats arrived');
      text += decoder.decode(chunk.value, { stream: true });
    }
    expect(text.trim()).toBe('');
    const posted = await fetch(`${server.url}/api/plans/${PLAN}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ask('opt-b', 'does this arrive?')),
      signal,
    });
    expect(posted.status).toBe(200);
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }

    const body = JSON.parse(text.trimStart()) as PollOutput;
    expect(body.status).toBe('messages');
    expect(body.messages[0]?.text).toBe('does this arrive?');
  });

  test('a real fetch abort drops the waiter count to zero', async () => {
    server = await startServer({ port: 0, stateDir: null, heartbeatMs: 5, assets: STUB_ASSETS });
    await put();
    const controller = new AbortController();

    await openPoll(controller.signal);
    await waitFor(() => server.app.polls.waiters(PLAN) === 1);
    controller.abort();

    await waitFor(() => server.app.polls.waiters(PLAN) === 0);
  });
});

describe('idle shutdown', () => {
  test('the helper closes itself after idleTimeoutMs with nothing connected', async () => {
    server = await startServer({ port: 0, stateDir: null, idleTimeoutMs: IDLE_TIMEOUT_MS, assets: STUB_ASSETS });
    const guard = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('helper did not close itself')), READ_GUARD_MS).unref();
    });

    await Promise.race([server.closed, guard]);

    await expect(fetch(`${server.url}/health`)).rejects.toThrow();
  });

  test('an open poll keeps the helper alive past idleTimeoutMs', async () => {
    server = await startServer({
      port: 0,
      stateDir: null,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      heartbeatMs: 5,
      browserGraceMs: 10_000,
      assets: STUB_ASSETS,
    });
    await put();
    const controller = new AbortController();
    const res = await openPoll(controller.signal);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await waitFor(() => server.app.polls.waiters(PLAN) === 1);
    let bytes = 0;

    while (bytes < BYTES_PAST_IDLE) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('poll stream ended before the idle window passed');
      bytes += chunk.value.length;
    }

    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);
    controller.abort();
  });
});

describe('shutdown route', () => {
  function postShutdown(headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${server.url}/api/shutdown`, { method: 'POST', headers });
  }

  function withinGuard<T>(work: Promise<T>, what: string): Promise<T> {
    const guard = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(what)), READ_GUARD_MS).unref();
    });
    return Promise.race([work, guard]);
  }

  test('POST /api/shutdown answers ok and the port stops accepting', async () => {
    server = await startServer({ port: 0, stateDir: null, assets: STUB_ASSETS });

    const crossOrigin = await postShutdown({ Origin: 'https://evil.example' });
    expect(crossOrigin.status).toBe(403);
    expect((await fetch(`${server.url}/health`)).status).toBe(200);

    const res = await postShutdown();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await withinGuard(server.closed, 'helper did not close after shutdown');

    await expect(fetch(`${server.url}/health`)).rejects.toThrow();
  });

  test('shutdown with an open poll ends the poll stream instead of hanging', async () => {
    server = await startServer({
      port: 0,
      stateDir: null,
      heartbeatMs: 5,
      browserGraceMs: 10_000,
      assets: STUB_ASSETS,
    });
    await put();
    const res = await openPoll(AbortSignal.timeout(READ_GUARD_MS));
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await waitFor(() => server.app.polls.waiters(PLAN) === 1);

    expect((await postShutdown()).status).toBe(200);

    const drain = async (): Promise<void> => {
      for (;;) {
        if ((await reader.read()).done) return;
      }
    };
    await withinGuard(
      drain().catch(() => undefined),
      'poll stream still open after shutdown',
    );
    await withinGuard(server.closed, 'helper did not close after shutdown');
    expect(server.app.polls.waiters(PLAN)).toBe(0);
  });
});
