import { expect, test } from '@playwright/test';
import { blockHtmlMap, seedPlan } from './support';

const ASKED = '[data-block="opt-b"] [data-state="asked"]';
const ANSWERED = '[data-block="opt-b"] [data-state="answered"]';

const planId = () => `live-patch-${Date.now()}`;

test("an answer posted through the api lands inside the asked block while every other block's outerHTML is unchanged", async ({
  page,
  request,
}) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-ask-0001', kind: 'ask', blockId: 'opt-b', text: 'why the timer?' },
  });
  await expect(page.locator(ASKED)).toHaveCount(1);
  const before = await blockHtmlMap(page);

  await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-1', md: 'Because it renews proactively.' } });
  await expect(page.locator(ANSWERED)).toContainText('Because it renews proactively.');
  const after = await blockHtmlMap(page);

  const { 'opt-b': changedBefore, ...othersBefore } = before;
  const { 'opt-b': changedAfter, ...othersAfter } = after;
  expect(changedAfter).not.toBe(changedBefore);
  expect(othersAfter).toEqual(othersBefore);
});

test('a stale block frame is ignored', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  for (const [n, text] of [
    ['1', 'why the timer?'],
    ['2', 'what about retries?'],
  ] as const) {
    await request.post(`/api/plans/${id}/messages`, {
      data: { clientId: `e2e-ask-000${n}`, kind: 'ask', blockId: 'opt-b', text },
    });
  }
  await expect(page.locator(ASKED)).toHaveCount(2);

  await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-1', md: 'First answer.' } });
  await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-2', md: 'Second answer.' } });
  await expect(page.locator(ANSWERED)).toHaveCount(2);

  const block = await (await request.get(`/api/plans/${id}/blocks/opt-b`)).json();
  await expect(page.locator('[data-block="opt-b"]')).toHaveAttribute('data-rev', String(block.rev));
});
