import { afterEach, describe, expect, it } from 'bun:test';
import { PollHub, type PollWhy } from '../../src/server/poll-hub';

const hubs: PollHub[] = [];

function makeHub(onChange?: () => void): PollHub {
  const hub = new PollHub({ heartbeatMs: 5, onChange });
  hubs.push(hub);
  return hub;
}

function guard<T>(work: Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(2000);
  const expired = new Promise<never>((_, reject) => {
    deadline.addEventListener('abort', () => reject(new Error('read exceeded 2000ms')));
  });
  return Promise.race([work, expired]);
}

afterEach(() => {
  for (const hub of hubs) hub.close();
  hubs.length = 0;
});

describe('PollHub', () => {
  it('listen registers a waiter and wake ends the body with the finish json', async () => {
    const hub = makeHub();
    const res = hub.listen('plan-1', 5000, new AbortController().signal, (why) => ({ status: why }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('pinpoint-poll-state')).toBe('listening');
    expect(hub.waiters('plan-1')).toBe(1);
    expect(hub.total()).toBe(1);

    hub.wake('plan-2', 'message');
    expect(hub.waiters('plan-1')).toBe(1);

    hub.wake('plan-1', 'message');
    const text = await guard(res.text());
    expect(JSON.parse(text)).toEqual({ status: 'message' });
    expect(hub.waiters('plan-1')).toBe(0);
    expect(hub.total()).toBe(0);
  });

  it('awaits an async finish before ending the body', async () => {
    const hub = makeHub();
    const res = hub.listen('plan-1', 5000, new AbortController().signal, async (why) => {
      await Promise.resolve();
      return { status: why, messages: [] };
    });

    hub.wake('plan-1', 'browser_closed');
    expect(JSON.parse(await guard(res.text()))).toEqual({ status: 'browser_closed', messages: [] });
  });

  it('abort removes the waiter and calls onChange', async () => {
    let changes = 0;
    const hub = makeHub(() => {
      changes += 1;
    });
    const controller = new AbortController();
    const whys: PollWhy[] = [];
    const res = hub.listen('plan-1', 5000, controller.signal, (why) => {
      whys.push(why);
      return { status: why };
    });
    expect(hub.waiters('plan-1')).toBe(1);
    expect(changes).toBe(1);

    controller.abort();

    expect(hub.waiters('plan-1')).toBe(0);
    expect(changes).toBe(2);
    expect(whys).toEqual([]);
    expect((await guard(res.text())).trim()).toBe('');
  });

  it("timeout finishes with 'timeout' and only whitespace precedes the json", async () => {
    const hub = makeHub();
    const res = hub.listen('plan-1', 30, new AbortController().signal, (why) => ({ status: why }));

    const text = await guard(res.text());

    expect(text.slice(0, text.indexOf('{')).trim()).toBe('');
    expect(JSON.parse(text.trimStart())).toEqual({ status: 'timeout' });
    expect(hub.waiters('plan-1')).toBe(0);
  });

  it('writes a heartbeat immediately and removes the waiter when the reader cancels', async () => {
    const hub = makeHub();
    const res = hub.listen('plan-1', 5000, new AbortController().signal, (why) => ({ status: why }));
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();

    const first = await guard(reader.read());
    expect(new TextDecoder().decode(first.value)).toBe(' ');

    await reader.cancel();
    expect(hub.waiters('plan-1')).toBe(0);
  });

  it('close ends every waiter without calling finish', async () => {
    const hub = makeHub();
    const whys: PollWhy[] = [];
    const finish = (why: PollWhy) => {
      whys.push(why);
      return { status: why };
    };
    const first = hub.listen('plan-1', 5000, new AbortController().signal, finish);
    const second = hub.listen('plan-2', 5000, new AbortController().signal, finish);
    expect(hub.total()).toBe(2);

    hub.close();

    expect(hub.total()).toBe(0);
    expect(whys).toEqual([]);
    expect((await guard(first.text())).trim()).toBe('');
    expect((await guard(second.text())).trim()).toBe('');
  });
});
