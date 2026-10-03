import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { ask, blockHtml, makeTestApp, seedPlan, type TestApp } from '../helpers/test-app';

const PLAN = 'auth-refresh';

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

  test('ask on an unknown block is 404 and the eleventh ask is 409 BLOCK_FULL', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const unknown = await post(ask('no-such-block', 'where am I?'));
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe('NOT_FOUND');

    for (let n = 1; n <= 10; n++) expect((await post(ask('opt-b', `question ${n}`))).status).toBe(200);
    const eleventh = await post(ask('opt-b', 'question 11'));
    expect(eleventh.status).toBe(409);
    expect(((await eleventh.json()) as { code: string }).code).toBe('BLOCK_FULL');
  });
});
