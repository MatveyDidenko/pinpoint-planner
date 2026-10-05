import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { PollOutput } from '../../src/core/output';
import { pendingMessages } from '../../src/core/state';
import type { PlanState } from '../../src/core/types';
import { filePersistence, memoryPersistence, type Persistence } from '../../src/server/persistence';
import { PlanStore } from '../../src/server/store';
import { ask, fixedClock, makeTestApp, seedPlan, TEST_BASE_URL, type TestApp, waitFor } from '../helpers/test-app';

const PLAN = 'auth-refresh';
const READ_GUARD_MS = 2000;

let t: TestApp;

afterEach(() => t.close());

function post(body: unknown, id = PLAN) {
  return t.request(`/api/plans/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function poll(query: string, init: RequestInit = {}, id = PLAN) {
  return t.request(`/api/plans/${id}/poll?${query}`, { signal: AbortSignal.timeout(READ_GUARD_MS), ...init });
}

async function pollJson(query: string): Promise<PollOutput> {
  const res = await poll(query);
  expect(res.status).toBe(200);
  return (await res.json()) as PollOutput;
}

async function postedId(body: unknown): Promise<string> {
  const res = await post(body);
  expect(res.status).toBe(200);
  return ((await res.json()) as { message: { id: string } }).message.id;
}

describe('GET /api/plans/:id/poll', () => {
  test('timeoutMs=0 with nothing pending answers waiting with no messages', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const body = await pollJson('timeoutMs=0');

    expect(body.status).toBe('waiting');
    expect(body.plan_id).toBe(PLAN);
    expect(body.messages).toEqual([]);
    expect(body.next_step).toContain('pinpoint poll auth-refresh');
    expect(body.page.pollers).toBe(1);
  });

  test('a posted message wakes a listening poll without sleeps', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const res = await poll('timeoutMs=5000');
    expect(res.headers.get('Pinpoint-Poll-State')).toBe('listening');
    expect(t.polls.waiters(PLAN)).toBe(1);

    const id = await postedId(ask('opt-b', 'why does this arrow go backwards?'));
    const body = (await res.json()) as PollOutput;

    expect(body.status).toBe('messages');
    expect(body.messages.map((m) => m.id)).toEqual([id]);
    expect(body.messages[0]).toMatchObject({
      kind: 'ask',
      block_id: 'opt-b',
      text: 'why does this arrow go backwards?',
    });
    expect(body.next_step).toContain(`answer auth-refresh --question ${id}`);
    expect(t.polls.waiters(PLAN)).toBe(0);
  });

  test('a poll that outlives its timeout answers waiting and leaves no waiter', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const res = await poll('timeoutMs=20');
    expect(t.polls.waiters(PLAN)).toBe(1);
    const body = (await res.json()) as PollOutput;

    expect(body.status).toBe('waiting');
    expect(body.messages).toEqual([]);
    expect(t.polls.waiters(PLAN)).toBe(0);
  });

  test('aborting the request removes the waiter', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const controller = new AbortController();

    await poll('timeoutMs=5000', { signal: controller.signal });
    expect(t.polls.waiters(PLAN)).toBe(1);
    controller.abort();

    await waitFor(() => t.polls.waiters(PLAN) === 0);
  });

  test('an unacked message is delivered again by the next poll and survives a new store', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const id = await postedId(ask('opt-b', 'is this retried?'));

    const first = await pollJson('timeoutMs=0');
    const second = await pollJson('timeoutMs=0');

    expect(first.status).toBe('messages');
    expect(first.messages.map((m) => m.id)).toEqual([id]);
    expect(second.messages.map((m) => m.id)).toEqual([id]);
    const reloaded = new PlanStore(t.persistence, fixedClock());
    expect(pendingMessages(reloaded.get(PLAN) as PlanState).map((m) => m.id)).toEqual([id]);
  });

  test('a second delivery of an unacked message keeps the first deliveredAt', async () => {
    t = makeTestApp();
    await seedPlan(t);
    await postedId(ask('opt-b', 'is this retried?'));
    const deliveredAt = async () => {
      const state = (await (await t.request(`/api/plans/${PLAN}`)).json()) as PlanState;
      return state.messages[0]?.deliveredAt;
    };

    await pollJson('timeoutMs=0');
    const first = await deliveredAt();
    await pollJson('timeoutMs=0');

    expect(first).toBeDefined();
    expect(await deliveredAt()).toBe(first as string);
  });

  test('the message is saved before the poll is woken', async () => {
    const events: string[] = [];
    const inner = memoryPersistence();
    const recording: Persistence = {
      ...inner,
      save: (id, state) => {
        events.push('save');
        inner.save(id, state);
      },
    };
    const clock = fixedClock();
    t = makeTestApp({ clock, store: new PlanStore(recording, clock) });
    const wake = t.polls.wake.bind(t.polls);
    spyOn(t.polls, 'wake').mockImplementation((id, reason) => {
      events.push('wake');
      wake(id, reason);
    });
    await seedPlan(t);
    events.length = 0;

    await post(ask('opt-b', 'order matters'));

    expect(events).toEqual(['save', 'wake']);
  });

  test("a polled ask with a sketch carries the PNG's absolute path", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pinpoint-poll-sketch-'));
    try {
      const clock = fixedClock();
      t = makeTestApp({ clock, store: new PlanStore(filePersistence(dir, clock), clock) });
      await seedPlan(t);
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5]);
      await postedId({ ...ask('opt-b', 'like this?'), sketch: `data:image/png;base64,${png.toString('base64')}` });

      const [message] = (await pollJson('timeoutMs=0')).messages;

      expect(message?.sketch_path).toBe(join(dir, 'sketches', PLAN, 'm-1.png'));
      expect(isAbsolute(message?.sketch_path ?? '')).toBe(true);
      expect(readFileSync(message?.sketch_path ?? '')).toEqual(png);
      expect(Object.keys(message ?? {}).slice(-2)).toEqual(['sketch_path', 'at']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('two pollers both resolve with the same message and report two pollers', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const first = await poll('timeoutMs=5000');
    const second = await poll('timeoutMs=5000');
    expect(t.polls.waiters(PLAN)).toBe(2);
    const id = await postedId(ask('opt-b', 'who answers?'));
    const bodies = (await Promise.all([first.json(), second.json()])) as PollOutput[];

    for (const body of bodies) {
      expect(body.status).toBe('messages');
      expect(body.messages.map((m) => m.id)).toEqual([id]);
      expect(body.page.pollers).toBe(2);
      expect(body.next_step).toContain('Another poll is attached');
    }
  });

  test('a watch poll skips the messages it has seen and tells the agent to end its turn', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const first = await postedId(ask('opt-b', 'is this retried?'));
    const second = await postedId(ask('opt-a', 'and the wrapper?'));

    const body = await pollJson(`timeoutMs=0&watch=1&seen=${first}`);

    expect(body.messages.map((m) => m.id)).toEqual([second]);
    expect(body.next_step).toContain('the watch wakes you on the next message');
    expect((await pollJson(`timeoutMs=0&watch=1&seen=${first},${second}`)).status).toBe('waiting');
  });

  test('done acks every pending message, lists the unanswered ones, and the next poll waits', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const askId = await postedId(ask('opt-b', 'never answered'));
    const doneId = await postedId({ clientId: 'client-done-1', kind: 'done', text: '' });

    const body = await pollJson('timeoutMs=0');

    expect(body.status).toBe('done');
    expect(body.messages.map((m) => m.id)).toEqual([askId, doneId]);
    expect(body.next_step).toContain(`Unanswered questions: ${askId} (Way B`);
    expect(body.page.presence).toBe('handed-back');
    const state = (await (await t.request(`/api/plans/${PLAN}`)).json()) as PlanState;
    expect(state.messages.every((m) => m.ackedAt !== undefined)).toBe(true);
    const next = await pollJson('timeoutMs=0');
    expect(next.status).toBe('waiting');
    expect(next.messages).toEqual([]);
  });

  test('a poll with no browser attached resolves browser_closed after the grace', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const res = await poll('timeoutMs=500');
    expect(t.browserGrace.armed(PLAN)).toBe(true);
    const body = (await res.json()) as PollOutput;

    expect(body.status).toBe('browser_closed');
    expect(body.plan_id).toBe(PLAN);
    expect(body.messages).toEqual([]);
    expect(body.next_step).toBe(
      `The browser tab was closed. Do not poll or watch again on your own: tell the user the plan is still at ${TEST_BASE_URL}/plans/${PLAN} and ask whether to keep waiting.`,
    );
    expect(body.page.url).toBe(`${TEST_BASE_URL}/plans/${PLAN}`);
    expect(t.polls.waiters(PLAN)).toBe(0);
  });

  test('an SSE connect inside the grace cancels it and the poll keeps waiting', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const res = await poll('timeoutMs=500');
    expect(t.browserGrace.armed(PLAN)).toBe(true);
    const events = await t.request(`/api/plans/${PLAN}/events`);
    await waitFor(() => !t.browserGrace.armed(PLAN), 'grace timer cancelled');
    const id = await postedId(ask('opt-b', 'still there?'));
    const body = (await res.json()) as PollOutput;
    await events.body?.cancel();

    expect(body.status).toBe('messages');
    expect(body.messages.map((m) => m.id)).toEqual([id]);
  });
});
