import { expect, test } from '@playwright/test';
import { seedPlan, showOption } from './support';

const planId = () => `ask-${Date.now()}`;

const OPT_B_NAME = '[data-block="opt-b"] .option-name';
const OPT_B_PILL = '[data-block="opt-b"] [data-state="asked"]';

test('click a block, type, Enter → POST /messages observed and the pill reads Waiting inside that block', async ({
  page,
  request,
}) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await showOption(page, 'opt-b');
  await page.locator(OPT_B_NAME).click();
  await expect(page.locator('[data-block="opt-b"]')).toHaveAttribute('data-selected', '');
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.locator('#composer .composer-head')).toContainText('ASK ABOUT');

  await page.getByTestId('composer-input').fill('why the timer?');
  const posted = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith(`/api/plans/${id}/messages`),
  );
  await page.getByTestId('composer-input').press('Enter');
  const body = (await posted).postDataJSON();

  expect(body).toMatchObject({ kind: 'ask', blockId: 'opt-b', text: 'why the timer?' });
  await expect(page.locator(OPT_B_PILL)).toContainText('Waiting for the agent');
  await expect(page.getByTestId('composer')).toBeHidden();
  await expect(page.locator('[data-block][data-selected]')).toHaveCount(0);
});

test('clicking the choose button does not open the composer', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await page.getByTestId('choose-opt-a').click();

  await expect(page.getByTestId('composer')).toBeHidden();
  await expect(page.locator('[data-block][data-selected]')).toHaveCount(0);
});

test('typed text and focus survive the selected block being swapped by a poll delivery', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-ask-0001', kind: 'ask', blockId: 'opt-b', text: 'why the timer?' },
  });
  await page.goto(`/plans/${id}`);
  await expect(page.locator(OPT_B_PILL)).toContainText('Waiting for the agent');

  await showOption(page, 'opt-b');
  await page.locator(OPT_B_NAME).click();
  await page.getByTestId('composer-input').fill('draft text');

  await request.get(`/api/plans/${id}/poll?timeoutMs=0`);

  await expect(page.locator('[data-block="opt-b"] [data-state="delivered"]')).toContainText('The agent is reading');
  await expect(page.getByTestId('composer-input')).toHaveValue('draft text');
  await expect(page.getByTestId('composer-input')).toBeFocused();
  await expect(page.locator('[data-block="opt-b"]')).toHaveAttribute('data-selected', '');
});
