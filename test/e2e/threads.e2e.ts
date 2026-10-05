import { type APIRequestContext, expect, test } from '@playwright/test';
import { seedPlan, showOption } from './support';

const planId = (name: string) => `threads-${name}-${Date.now()}`;

async function ask(request: APIRequestContext, id: string, clientId: string, text: string, threadId?: string) {
  const response = await request.post(`/api/plans/${id}/messages`, {
    data: { clientId, kind: 'ask', blockId: 'opt-b', text, ...(threadId ? { threadId } : {}) },
  });
  expect(response.ok()).toBe(true);
}

async function answer(request: APIRequestContext, id: string, questionId: string) {
  const response = await request.post(`/api/plans/${id}/answers`, {
    data: { questionId, md: `Answer to ${questionId}.` },
  });
  expect(response.ok()).toBe(true);
}

test('Reply under an answer sends a follow-up into the same thread', async ({ page, request }) => {
  const id = planId('reply');
  await seedPlan(request, id);
  await ask(request, id, 'e2e-thread-0001', 'why the timer?');
  await ask(request, id, 'e2e-thread-0002', 'what about tabs?');
  await answer(request, id, 'm-1');
  await page.goto(`/plans/${id}`);

  await showOption(page, 'opt-b');
  await page.getByTestId('reply-m-1').click();
  const composer = page.getByTestId('composer');
  await expect(composer).toBeVisible();
  await expect(page.locator('#composer .composer-head')).toHaveText('REPLY · Way B · Proactive refresh timer');

  const firstThread = await page.getByTestId('thread-m-1').boundingBox();
  const secondThread = await page.getByTestId('thread-m-2').boundingBox();
  const box = await composer.boundingBox();
  if (firstThread === null || secondThread === null || box === null) throw new Error('missing layout');
  expect(box.y).toBeGreaterThan(firstThread.y + firstThread.height);
  expect(box.y).toBeLessThan(secondThread.y + secondThread.height);

  await page.getByTestId('composer-input').fill('half a reply');
  await page.locator('[data-block="opt-b"] .option-name').click();
  await expect(page.locator('#composer .composer-head')).toContainText('ASK ABOUT');
  await expect(page.getByTestId('composer-input')).toHaveValue('');
  await page.getByTestId('reply-m-1').click();
  await expect(page.getByTestId('composer-input')).toHaveValue('half a reply');

  await page.getByTestId('composer-input').fill('and when the laptop wakes?');
  const posted = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith(`/api/plans/${id}/messages`),
  );
  await page.getByTestId('composer-input').press('Enter');

  expect((await posted).postDataJSON()).toMatchObject({
    kind: 'ask',
    blockId: 'opt-b',
    threadId: 'm-1',
    text: 'and when the laptop wakes?',
  });
  await expect(composer).toBeHidden();
  const followup = page.locator('[data-testid="thread-m-1"] .exchange--followup');
  await expect(followup).toContainText('and when the laptop wakes?');
  await expect(followup).toContainText('Waiting for the agent');
  await expect(page.getByTestId('reply-m-1')).toHaveCount(0);
});

test('after handing back the Reply button is disabled', async ({ page, request }) => {
  const id = planId('done');
  await seedPlan(request, id);
  await ask(request, id, 'e2e-thread-0003', 'why the timer?');
  await answer(request, id, 'm-1');
  await page.goto(`/plans/${id}`);

  await showOption(page, 'opt-b');
  const reply = page.getByTestId('reply-m-1');
  await expect(reply).toBeEnabled();
  await page.getByTestId('done').click();
  await page.getByTestId('done-yes').click();

  await expect(reply).toBeDisabled();
  await reply.click({ force: true });
  await expect(page.getByTestId('composer')).toBeHidden();
});

test('a reply rejected as THREAD_BUSY keeps the text and explains why', async ({ page, request }) => {
  const id = planId('busy');
  await seedPlan(request, id);
  await ask(request, id, 'e2e-thread-0004', 'why the timer?');
  await answer(request, id, 'm-1');
  await page.goto(`/plans/${id}`);

  await showOption(page, 'opt-b');
  await page.getByTestId('reply-m-1').click();
  await page.getByTestId('composer-input').fill('racing reply');
  await ask(request, id, 'e2e-thread-0005', 'sent from elsewhere', 'm-1');

  const responded = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith(`/api/plans/${id}/messages`),
  );
  await page.getByTestId('composer-input').press('Enter');
  const response = await responded;

  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'THREAD_BUSY' });
  await expect(page.locator('#composer .composer-hint')).toHaveText('Wait for the answer before replying.');
  await expect(page.getByTestId('composer-input')).toHaveValue('racing reply');
  await expect(page.getByTestId('composer')).toBeVisible();
});
