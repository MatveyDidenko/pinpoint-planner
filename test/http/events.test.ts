import { afterEach, describe, expect, test } from 'bun:test';
import { ask, fixture, makeTestApp, readFrames, seedPlan, type TestApp } from '../helpers/test-app';

const PLAN = 'auth-refresh';
const PLAN_ORDER = ['context', 'opt-a', 'opt-b', 'opt-c', 'verdict'];

let t: TestApp;
const controllers: AbortController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
  t.close();
});

function send(method: string, path: string, body: unknown) {
  return t.request(`/api/plans/${PLAN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function connect(since: number | string): Promise<Response> {
  const controller = new AbortController();
  controllers.push(controller);
  const res = await t.request(`/api/plans/${PLAN}/events?since=${since}`, { signal: controller.signal });
  expect(res.status).toBe(200);
  return res;
}

async function askQuestion(blockId: string, text: string): Promise<string> {
  const res = await send('POST', '/messages', ask(blockId, text));
  return ((await res.json()) as { message: { id: string } }).message.id;
}

async function answer(questionId: string) {
  const res = await send('POST', '/answers', { ...fixture('answer.opt-b'), questionId });
  expect(res.status).toBe(200);
}

describe('GET /api/plans/:id/events', () => {
  test('hello then one block frame per block touched since the given revision, then live frames after an answer', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const questionId = await askQuestion('opt-b', 'what happens when the laptop sleeps?');

    const res = await connect(1);
    const initial = await readFrames(res, 2);

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(initial[0]).toEqual({ event: 'hello', data: { revision: 2, presence: 'waiting', review: 'open' } });
    expect(initial[1]?.event).toBe('block');
    expect(initial[1]?.data).toMatchObject({ blockId: 'opt-b', rev: 2, revision: 2 });
    expect(t.sse.clients(PLAN)).toBe(1);

    await answer(questionId);
    const live = await readFrames(res, 2);

    expect(live[0]?.event).toBe('block');
    expect(live[0]?.data).toMatchObject({ blockId: 'opt-b', rev: 3, revision: 3 });
    expect(live[1]).toEqual({ event: 'presence', data: { presence: 'waiting', undelivered: 0 } });
  });

  test('reconnecting with since=0 after three answers on one block yields exactly one frame for that block', async () => {
    t = makeTestApp();
    await seedPlan(t);
    for (const text of ['one?', 'two?', 'three?']) await answer(await askQuestion('opt-b', text));

    const frames = await readFrames(await connect(0), 1 + PLAN_ORDER.length);

    expect(frames[0]).toEqual({ event: 'hello', data: { revision: 7, presence: 'waiting', review: 'open' } });
    expect(frames.slice(1).map((f) => f.event)).toEqual(PLAN_ORDER.map(() => 'block'));
    expect(frames.slice(1).map((f) => (f.data as { blockId: string }).blockId)).toEqual(PLAN_ORDER);
    expect(frames[3]?.data).toMatchObject({ blockId: 'opt-b', rev: 7, revision: 7 });
  });

  test('a missing or invalid since replays every block', async () => {
    t = makeTestApp();
    await seedPlan(t);

    for (const since of ['', 'abc']) {
      const frames = await readFrames(await connect(since), 1 + PLAN_ORDER.length);
      expect(frames.slice(1).map((f) => (f.data as { blockId: string }).blockId)).toEqual(PLAN_ORDER);
    }
  });

  test('a steps block created after since replays as appended after the block before it', async () => {
    t = makeTestApp();
    await seedPlan(t);
    expect((await send('POST', '/steps', fixture('steps.opt-a'))).status).toBe(200);

    const frames = await readFrames(await connect(1), 3);

    expect(frames[0]).toEqual({ event: 'hello', data: { revision: 2, presence: 'waiting', review: 'open' } });
    expect(frames[1]?.event).toBe('block');
    expect(frames[1]?.data).toMatchObject({ blockId: 'opt-a', rev: 2 });
    expect(frames[2]?.event).toBe('appended');
    expect(frames[2]?.data).toMatchObject({ blockId: 'steps-opt-a', after: 'verdict', rev: 1, revision: 2 });
  });

  test('presence flips to listening on poll attach and back on abort', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const res = await connect(1);
    const [hello] = await readFrames(res, 1);
    expect(hello?.data).toMatchObject({ presence: 'waiting' });

    const pollController = new AbortController();
    controllers.push(pollController);
    await t.request(`/api/plans/${PLAN}/poll?timeoutMs=5000`, { signal: pollController.signal });
    const [listening] = await readFrames(res, 1);
    pollController.abort();
    const [waiting] = await readFrames(res, 1);

    expect(listening).toEqual({ event: 'presence', data: { presence: 'listening', undelivered: 0 } });
    expect(waiting).toEqual({ event: 'presence', data: { presence: 'waiting', undelivered: 0 } });
  });

  test('an undelivered message is counted in presence and delivery flips it to working', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const res = await connect(1);
    await readFrames(res, 1);

    await askQuestion('opt-b', 'who answers?');
    const posted = await readFrames(res, 2);

    expect(posted[0]?.event).toBe('block');
    expect(posted[1]).toEqual({ event: 'presence', data: { presence: 'waiting', undelivered: 1 } });

    const delivered = await t.request(`/api/plans/${PLAN}/poll?timeoutMs=0`);
    expect(delivered.status).toBe(200);
    const afterDelivery = await readFrames(res, 2);

    expect(afterDelivery[0]?.event).toBe('block');
    expect(afterDelivery[1]).toEqual({ event: 'presence', data: { presence: 'working', undelivered: 0 } });
  });

  test('replacing a plan broadcasts a plan frame with the new revision', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const res = await connect(1);
    await readFrames(res, 1);

    const replaced = await seedPlan(t);
    const [frame] = await readFrames(res, 1);

    expect(frame).toEqual({ event: 'plan', data: { revision: replaced.revision } });
  });
});
