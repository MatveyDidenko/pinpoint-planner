import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { ask, blockHtml, makeTestApp, seedPlan, type TestApp } from '../helpers/test-app';

const PLAN = 'auth-refresh';
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const sketchUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

let t: TestApp;

afterEach(() => t.close());

function post(body: unknown, id = PLAN) {
  return t.request(`/api/plans/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/plans/:id/messages', () => {
  test('an ask answers with the message, the re-rendered block and the new revision', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const res = await post(ask('opt-b', 'why does this arrow go backwards?'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: { id: string; kind: string; text: string };
      block: { blockId: string; rev: number; html: string };
      revision: number;
      duplicate: boolean;
    };
    expect(body.message).toMatchObject({ kind: 'ask', text: 'why does this arrow go backwards?' });
    expect(body.duplicate).toBe(false);
    expect(body.revision).toBe(2);
    expect(body.block.blockId).toBe('opt-b');
    expect(body.block.rev).toBe(2);
    expect(body.block.html).toBe(await blockHtml(t, PLAN, 'opt-b'));
  });

  test('a repeated clientId is a 200 duplicate that returns the stored message and does not wake a poll', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const wake = spyOn(t.polls, 'wake');
    const message = ask('opt-b', 'once only');
    const first = (await (await post(message)).json()) as { message: { id: string }; revision: number };

    const res = await post(message);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: expect.objectContaining({ id: first.message.id, text: 'once only' }),
      revision: first.revision,
      duplicate: true,
    });
    expect(wake).toHaveBeenCalledTimes(1);
    wake.mockRestore();
  });

  test('a body that is not a browser message is 400 INVALID_INPUT with issues', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const res = await post({ clientId: 'short', kind: 'ask', text: '' });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; issues: { path: string }[] };
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  test('a reply while the thread waits for its answer is 409 THREAD_BUSY', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const first = (await (await post(ask('opt-b', 'why a timer?'))).json()) as { message: { id: string } };

    const res = await post({ ...ask('opt-b', 'and when the laptop sleeps?'), threadId: first.message.id });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'THREAD_BUSY', message: 'Wait for the answer before replying.' });
  });

  test('ask on an unknown block is 404 and the forty-first ask is 409 BLOCK_FULL', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const unknown = await post(ask('no-such-block', 'where am I?'));
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe('NOT_FOUND');

    for (let n = 1; n <= 40; n++) expect((await post(ask('opt-b', `question ${n}`))).status).toBe(200);
    const fortyFirst = await post(ask('opt-b', 'question 41'));
    expect(fortyFirst.status).toBe(409);
    expect(((await fortyFirst.json()) as { code: string }).code).toBe('BLOCK_FULL');
  });

  test('an ask with a sketch saves the PNG and marks the exchange', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const message = { ...ask('opt-b', 'like this?'), sketch: sketchUrl(PNG_BYTES) };

    const res = await post(message);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: { id: string; sketch?: boolean } };
    expect(body.message.sketch).toBe(true);
    expect(t.persistence.loadSketch(PLAN, body.message.id)).toEqual(PNG_BYTES);
    const stored = t.persistence.load(PLAN);
    expect(stored?.plan.blocks.find((b) => b.id === 'opt-b')?.qa.at(-1)).toMatchObject({
      id: body.message.id,
      sketch: true,
    });
    expect(JSON.stringify(stored)).not.toContain('data:image');
    const retry = await post(message);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { duplicate: boolean }).duplicate).toBe(true);
  });

  test('a sketch whose bytes are not a PNG is 400 INVALID_INPUT on sketch and posts nothing', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const res = await post({ ...ask('opt-b', 'like this?'), sketch: sketchUrl(new TextEncoder().encode('GIF89a')) });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; issues: { path: string }[] };
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.issues.map((issue) => issue.path)).toEqual(['sketch']);
    expect(t.persistence.load(PLAN)?.messages).toEqual([]);
  });
});

describe('GET /api/plans/:id/sketches/:mid.png', () => {
  test('a saved sketch is served as image/png', async () => {
    t = makeTestApp();
    await seedPlan(t);
    await post({ ...ask('opt-b', 'like this?'), sketch: sketchUrl(PNG_BYTES) });

    const res = await t.request(`/api/plans/${PLAN}/sketches/m-1.png`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test('an unknown sketch is 404', async () => {
    t = makeTestApp();
    await seedPlan(t);
    await post({ ...ask('opt-b', 'like this?'), sketch: sketchUrl(PNG_BYTES) });
    await post(ask('opt-b', 'no drawing here'));

    for (const path of [
      `/api/plans/${PLAN}/sketches/m-2.png`,
      `/api/plans/${PLAN}/sketches/m-9.png`,
      `/api/plans/${PLAN}/sketches/m-1`,
      `/api/plans/${PLAN}/sketches/..%2F..%2Fplans%2F${PLAN}.json`,
      '/api/plans/no-such-plan/sketches/m-1.png',
    ]) {
      const res = await t.request(path);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
    }
  });
});
