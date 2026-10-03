import { afterEach, describe, expect, it } from 'bun:test';
import { encodeFrame, SseHub } from '../../src/server/sse-hub';
import type { SseFrame } from '../../src/shared/frames';

const hubs: SseHub[] = [];

function makeHub(onChange?: () => void): SseHub {
  const hub = new SseHub({ heartbeatMs: 5, onChange });
  hubs.push(hub);
  return hub;
}

function countFrames(text: string): number {
  return text.split('\n\n').filter((chunk) => chunk.startsWith('event:')).length;
}

async function readFrames(res: Response, wanted: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('response has no body');
  const decoder = new TextDecoder();
  const deadline = AbortSignal.timeout(2000);
  const expired = new Promise<never>((_, reject) => {
    deadline.addEventListener('abort', () => reject(new Error('read exceeded 2000ms')));
  });
  let text = '';
  while (countFrames(text) < wanted) {
    const { value, done } = await Promise.race([reader.read(), expired]);
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  return text;
}

afterEach(() => {
  for (const hub of hubs) hub.close();
  hubs.length = 0;
});

const hello: SseFrame = { event: 'hello', data: { revision: 4, presence: 'waiting', review: 'open' } };
const block: SseFrame = {
  event: 'block',
  data: { blockId: 'opt-b', rev: 3, html: '<section></section>', revision: 5 },
};

describe('SseHub', () => {
  it('subscribe streams the initial frames then a broadcast frame', async () => {
    const hub = makeHub();
    const res = hub.subscribe('plan-1', new AbortController().signal, [hello]);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(hub.clients('plan-1')).toBe(1);

    hub.broadcast('plan-2', { event: 'plan', data: { revision: 9 } });
    hub.broadcast('plan-1', block);

    const text = await readFrames(res, 2);
    expect(text).toContain(encodeFrame(hello));
    expect(text).toContain(encodeFrame(block));
    expect(text).not.toContain('"revision":9');
    expect(text.indexOf(encodeFrame(hello))).toBeLessThan(text.indexOf(encodeFrame(block)));
    expect(text).toContain(': hb\n\n');
  });

  it('encodeFrame writes the event name and one json data line', () => {
    expect(encodeFrame({ event: 'plan', data: { revision: 15 } })).toBe('event: plan\ndata: {"revision":15}\n\n');
  });

  it('abort drops the client count to zero', () => {
    let changes = 0;
    const hub = makeHub(() => {
      changes += 1;
    });
    const controller = new AbortController();
    hub.subscribe('plan-1', controller.signal, []);
    hub.subscribe('plan-1', new AbortController().signal, []);
    expect(hub.clients('plan-1')).toBe(2);
    expect(hub.total()).toBe(2);
    expect(changes).toBe(2);

    controller.abort();
    expect(hub.clients('plan-1')).toBe(1);
    expect(changes).toBe(3);

    hub.close();
    expect(hub.clients('plan-1')).toBe(0);
    expect(hub.total()).toBe(0);
  });
});
