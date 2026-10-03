import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { renderBlock } from '../../src/core/render/blocks';
import { ask, blockHtml, fixture, makeTestApp, seedPlan, type TestApp } from '../helpers/test-app';

const PLAN = 'auth-refresh';

let t: TestApp;

afterEach(() => t.close());

function send(method: string, path: string, body: unknown) {
  return t.request(`/api/plans/${PLAN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function askQuestion(blockId: string, text: string): Promise<string> {
  const res = await send('POST', '/messages', ask(blockId, text));
  return ((await res.json()) as { message: { id: string } }).message.id;
}

function blockIds(): string[] {
  return (t.store.get(PLAN)?.plan.blocks ?? []).map((b) => b.id);
}

interface Receipt {
  status: string;
  plan_id: string;
  touched: string[];
  revision: number;
  untouched_unchanged: boolean;
  acked: string[];
  pending: number;
  next_step: string;
}

describe('agent mutation receipts', () => {
  test("answer touches one block and every other block's html is byte-identical before and after", async () => {
    t = makeTestApp();
    await seedPlan(t);
    const questionId = await askQuestion('opt-b', 'what happens when the laptop sleeps?');
    const ids = blockIds();
    const before = await Promise.all(ids.map((id) => blockHtml(t, PLAN, id)));

    const res = await send('POST', '/answers', { ...fixture('answer.opt-b'), questionId });

    expect(res.status).toBe(200);
    const receipt = (await res.json()) as Receipt;
    expect(receipt).toMatchObject({
      status: 'answered',
      plan_id: PLAN,
      touched: ['opt-b'],
      revision: 3,
      untouched_unchanged: true,
      acked: [questionId],
      pending: 0,
    });
    expect(receipt.next_step).toContain('Do not respond to the user yet.');
    const after = await Promise.all(ids.map((id) => blockHtml(t, PLAN, id)));
    ids.forEach((id, index) => {
      if (id === 'opt-b') expect(after[index]).not.toBe(before[index]);
      else expect(after[index]).toBe(before[index]);
    });
  });

  test('steps appends a block with after set to the previous last block', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const previousLast = blockIds().at(-1);
    const broadcast = spyOn(t.sse, 'broadcast');

    const res = await send('POST', '/steps', fixture('steps.opt-a'));

    expect(res.status).toBe(200);
    const receipt = (await res.json()) as Receipt;
    expect(receipt).toMatchObject({
      status: 'steps-appended',
      touched: ['opt-a', 'steps-opt-a'],
      untouched_unchanged: true,
    });
    expect(blockIds().at(-1)).toBe('steps-opt-a');
    const frames = broadcast.mock.calls.map(([, frame]) => frame);
    const events = frames.map((f) => f.event);
    expect(events.filter((event) => event === 'block' || event === 'appended')).toEqual(['block', 'appended']);
    expect(events.lastIndexOf('presence')).toBeGreaterThan(events.indexOf('appended'));
    expect(frames[1]?.data).toMatchObject({ blockId: 'steps-opt-a', after: previousLast });
    broadcast.mockRestore();
  });

  test('a renderer made nondeterministic through deps yields 500 INVARIANT_VIOLATION and leaves the stored state unchanged', async () => {
    let counter = 0;
    t = makeTestApp({ render: (block) => renderBlock(block) + counter++ });
    await seedPlan(t);
    const questionId = await askQuestion('opt-b', 'what happens when the laptop sleeps?');
    const stored = structuredClone(t.store.get(PLAN));
    const saves = t.persistence.saves;

    const res = await send('POST', '/answers', { ...fixture('answer.opt-b'), questionId });

    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('INVARIANT_VIOLATION');
    expect(t.store.get(PLAN)).toEqual(stored);
    expect(t.persistence.saves).toBe(saves);
  });

  test('second answer is 409 ALREADY_ANSWERED and second steps is 409 STEPS_EXIST', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const questionId = await askQuestion('opt-b', 'what happens when the laptop sleeps?');
    const answer = { ...fixture('answer.opt-b'), questionId };
    expect((await send('POST', '/answers', answer)).status).toBe(200);
    expect((await send('POST', '/steps', fixture('steps.opt-a'))).status).toBe(200);

    const secondAnswer = await send('POST', '/answers', answer);
    const secondSteps = await send('POST', '/steps', fixture('steps.opt-a'));

    expect(secondAnswer.status).toBe(409);
    expect(((await secondAnswer.json()) as { code: string }).code).toBe('ALREADY_ANSWERED');
    expect(secondSteps.status).toBe(409);
    expect(((await secondSteps.json()) as { code: string }).code).toBe('STEPS_EXIST');
  });

  test('a body that fails validation is 400 INVALID_INPUT on every mutation route', async () => {
    t = makeTestApp();
    await seedPlan(t);

    for (const [method, path] of [
      ['POST', '/answers'],
      ['POST', '/steps'],
      ['PUT', '/blocks/opt-b'],
      ['POST', '/acks'],
    ] as const) {
      const res = await send(method, path, { nonsense: true });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('INVALID_INPUT');
    }
  });

  test('patch touches the patched block and acks reports the messages it acknowledged', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const questionId = await askQuestion('opt-b', 'what happens when the laptop sleeps?');

    const patched = await send('PUT', '/blocks/opt-b', fixture('block.opt-b.patched'));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ status: 'patched', touched: ['opt-b'], acked: [], pending: 1 });

    const acked = await send('POST', '/acks', { ids: [questionId] });
    expect(acked.status).toBe(200);
    expect(await acked.json()).toMatchObject({ status: 'acked', touched: [], acked: [questionId], pending: 0 });
  });
});
