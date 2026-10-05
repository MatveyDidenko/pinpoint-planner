import { expect, test } from '@playwright/test';
import { seedPlan, showOption } from './support';

const planId = (name: string) => `presence-${name}-${Date.now()}`;

test('chip reads not on the line, then on the line while a poll is pending, working after an ask, back after the answer', async ({
  page,
  request,
}) => {
  const id = planId('flow');
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  const chip = page.getByTestId('presence');
  await expect(chip).toHaveAttribute('data-state', 'waiting');
  await expect(chip.locator('.presence-label')).toHaveText('Agent not on the line');

  const pending = request.get(`/api/plans/${id}/poll?timeoutMs=4000`);
  await expect(chip).toHaveAttribute('data-state', 'listening');
  await expect(chip.locator('.presence-label')).toHaveText('Agent on the line');

  await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-presence-0001', kind: 'ask', blockId: 'opt-b', text: 'why the timer?' },
  });
  await pending;
  await expect(chip).toHaveAttribute('data-state', 'working');
  await expect(chip.locator('.presence-label')).toHaveText('Agent working…');

  await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-1', md: 'Because it renews proactively.' } });
  await expect(chip).toHaveAttribute('data-state', 'waiting');
  await expect(chip.locator('.presence-label')).toHaveText('Agent not on the line');
});

test('the chip shows a waiting count when a question is queued and no agent is on the line', async ({
  page,
  request,
}) => {
  const id = planId('count');
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-presence-0002', kind: 'ask', blockId: 'opt-b', text: 'why the timer?' },
  });

  const chip = page.getByTestId('presence');
  await expect(chip).toHaveAttribute('data-state', 'waiting');
  await expect(chip.locator('.presence-label')).toHaveText('Agent not on the line · 1 question waiting');
});

test('Done hands back: chip shows handed back and the composer cannot open', async ({ page, request }) => {
  const id = planId('done');
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  const posted = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith(`/api/plans/${id}/messages`),
  );
  await page.getByTestId('done').click();
  await expect(page.getByTestId('done-confirm')).toContainText('Hand back now?');
  await page.getByTestId('done-yes').click();
  expect((await posted).postDataJSON()).toMatchObject({ kind: 'done', text: '' });

  const chip = page.getByTestId('presence');
  await expect(chip).toHaveAttribute('data-state', 'handed-back');
  await expect(chip.locator('.presence-label')).toHaveText('Handed back to the agent');
  await expect(page.getByTestId('done')).toBeDisabled();

  const block = page.locator('[data-block="opt-b"]');
  await showOption(page, 'opt-b');
  await page.locator('[data-block="opt-b"] .option-name').click();
  await expect(page.getByTestId('composer')).toBeHidden();
  await expect(block).not.toHaveAttribute('data-selected', '');

  await block.focus();
  await block.press('Enter');
  await expect(page.getByTestId('composer')).toBeHidden();
  await expect(block).not.toHaveAttribute('data-selected', '');
});

test('a poll after Done returns status done listing the unanswered question', async ({ page, request }) => {
  const id = planId('poll');
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await showOption(page, 'opt-b');
  await page.locator('[data-block="opt-b"] .option-name').click();
  await page.getByTestId('composer-input').fill('why the timer?');
  await page.getByTestId('composer-input').press('Enter');
  await expect(page.locator('[data-block="opt-b"] [data-state="asked"]')).toContainText('Waiting for the agent');

  await page.getByTestId('done').click();
  await page.getByTestId('done-yes').click();
  await expect(page.getByTestId('presence')).toHaveAttribute('data-state', 'handed-back');

  const poll = await request.get(`/api/plans/${id}/poll?timeoutMs=0`);
  const body = await poll.json();
  expect(body.status).toBe('done');
  expect(body.next_step).toContain('Unanswered questions:');
  expect(body.next_step).toContain('m-1');
});
