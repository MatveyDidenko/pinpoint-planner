import { afterEach, describe, expect, test } from 'bun:test';
import { renderBlock } from '../../src/core/render/blocks';
import { FONT_FILES } from '../../src/server/assets';
import { blockHtml, fixture, makeTestApp, seedPlan, TEST_BASE_URL, type TestApp } from '../helpers/test-app';

let t: TestApp;

afterEach(() => t.close());

function put(path: string, body: unknown) {
  return t.request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('PUT /api/plans/:id', () => {
  test('PUT creates with 201 then replaces with 200 and the page lists every block', async () => {
    t = makeTestApp();
    const input = fixture('plan.auth-refresh');

    const created = await put('/api/plans/auth-refresh', input);
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { block_ids: string[]; [key: string]: unknown };
    expect(createdBody).toEqual({
      plan_id: 'auth-refresh',
      url: `${TEST_BASE_URL}/plans/auth-refresh`,
      revision: 1,
      block_ids: createdBody.block_ids,
      dropped_messages: [],
    });
    expect(createdBody.block_ids.length).toBe(5);

    const replaced = await put('/api/plans/auth-refresh', { ...input, title: 'Refresh tokens, second draft' });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({
      plan_id: 'auth-refresh',
      url: `${TEST_BASE_URL}/plans/auth-refresh`,
      revision: 2,
      block_ids: createdBody.block_ids,
      dropped_messages: [],
    });

    const page = await t.request('/plans/auth-refresh');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('Refresh tokens, second draft');
    for (const id of createdBody.block_ids) expect(html).toContain(`data-block="${id}"`);
  });

  test('PUT with a mismatched id is 400 INVALID_INPUT with issues', async () => {
    t = makeTestApp();

    const res = await put('/api/plans/other-plan', fixture('plan.auth-refresh'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string; issues: { path: string; message: string }[] };
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.issues).toEqual([{ path: 'id', message: expect.stringContaining('other-plan') }]);
    expect(t.store.has('other-plan')).toBe(false);
    expect(t.store.has('auth-refresh')).toBe(false);
  });

  test('invalid JSON and schema failures are 400 INVALID_INPUT with issues', async () => {
    t = makeTestApp();

    const garbage = await put('/api/plans/auth-refresh', '{not json');
    expect(garbage.status).toBe(400);
    const garbageBody = (await garbage.json()) as { code: string; issues: unknown[] };
    expect(garbageBody.code).toBe('INVALID_INPUT');
    expect(garbageBody.issues.length).toBeGreaterThan(0);

    const schema = await put('/api/plans/auth-refresh', fixture('invalid/plan.five-options'));
    expect(schema.status).toBe(400);
    const schemaBody = (await schema.json()) as { code: string; issues: { path: string }[] };
    expect(schemaBody.code).toBe('INVALID_INPUT');
    expect(schemaBody.issues.some((issue) => issue.path === 'options')).toBe(true);
  });

  test('a cross-origin PUT is 403 and a non-loopback host is 403 on pages too', async () => {
    t = makeTestApp();

    const forged = await t.request('/api/plans/auth-refresh', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.com' },
      body: JSON.stringify(fixture('plan.auth-refresh')),
    });
    expect(forged.status).toBe(403);
    expect(t.store.has('auth-refresh')).toBe(false);

    const rebound = await t.app.request('http://evil.com/');
    expect(rebound.status).toBe(403);
  });
});

describe('read routes', () => {
  test('unknown plan and unknown font file are 404', async () => {
    t = makeTestApp();
    await seedPlan(t);

    const api = await t.request('/api/plans/missing-plan');
    expect(api.status).toBe(404);
    expect(((await api.json()) as { code: string }).code).toBe('NOT_FOUND');

    const page = await t.request('/plans/missing-plan');
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toContain('text/html');

    expect((await t.request('/api/plans/missing-plan/blocks/findings')).status).toBe(404);
    const noBlock = await t.request('/api/plans/auth-refresh/blocks/nope');
    expect(noBlock.status).toBe(404);
    expect(((await noBlock.json()) as { code: string }).code).toBe('NOT_FOUND');
    expect((await t.request('/api/plans/auth-refresh/blocks/nope.html')).status).toBe(404);

    expect((await t.request('/fonts/not-a-font.woff2')).status).toBe(404);
    expect((await t.request('/fonts/..%2Fpackage.json')).status).toBe(404);

    const [known] = Object.keys(FONT_FILES);
    const font = await t.request(`/fonts/${known}`);
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect(font.headers.get('cache-control')).toContain('immutable');
  });

  test('GET / links every stored plan', async () => {
    t = makeTestApp();
    const empty = await (await t.request('/')).text();
    expect(empty).toContain('data-testid="home-empty"');

    await seedPlan(t, 'auth-refresh');
    await seedPlan(t, 'billing-retry');

    const res = await t.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain(`href="${TEST_BASE_URL}/plans/auth-refresh"`);
    expect(html).toContain(`href="${TEST_BASE_URL}/plans/billing-retry"`);

    const list = (await (await t.request('/api/plans')).json()) as { plans: { id: string; presence: string }[] };
    expect(list.plans.map((plan) => plan.id)).toEqual(['auth-refresh', 'billing-retry']);
    expect(list.plans.every((plan) => plan.presence === 'waiting')).toBe(true);
  });

  test('block routes return the stored state, block JSON and exactly renderBlock html', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const state = t.store.get('auth-refresh');
    if (state === undefined) throw new Error('plan was not stored');
    const block = state.plan.blocks[1];
    if (block === undefined) throw new Error('fixture has no second block');

    expect(await (await t.request('/api/plans/auth-refresh')).json()).toEqual(JSON.parse(JSON.stringify(state)));
    expect(await (await t.request(`/api/plans/auth-refresh/blocks/${block.id}`)).json()).toEqual(
      JSON.parse(JSON.stringify(block)),
    );
    const htmlRes = await t.request(`/api/plans/auth-refresh/blocks/${block.id}.html`);
    expect(htmlRes.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await blockHtml(t, 'auth-refresh', block.id)).toBe(renderBlock(block));
  });

  test('health reports the plans, the version and whether anything is connected', async () => {
    t = makeTestApp({ stateDir: '/tmp/pinpoint-test' });
    await seedPlan(t);

    const body = (await (await t.request('/health')).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      app: 'pinpoint',
      version: '0.0.0-test',
      startedAt: '2026-10-03T17:59:00.000Z',
      stateDir: '/tmp/pinpoint-test',
      busy: false,
    });
    expect((body.plans as { id: string }[]).map((plan) => plan.id)).toEqual(['auth-refresh']);
  });
});
