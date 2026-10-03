import { expect, test } from '@playwright/test';
import { seedPlan } from './support';

const planId = () => `drafts-${Date.now()}`;

const BLOCK = (blockId: string) => `[data-block="${blockId}"] .option-name`;

test('a draft typed on opt-c is restored after reload when opt-c is selected again', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await page.locator(BLOCK('opt-c')).click();
  await page.getByTestId('composer-input').fill('half a thought');

  await page.reload();
  await page.locator(BLOCK('opt-c')).click();
  await expect(page.getByTestId('composer-input')).toHaveValue('half a thought');

  await page.locator(BLOCK('opt-a')).click();
  await expect(page.getByTestId('composer-input')).toHaveValue('');
});

test('the composer still works when sessionStorage throws', async ({ page, request }) => {
  const id = planId();
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('denied');
      },
    });
  });
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await page.locator(BLOCK('opt-b')).click();
  await page.getByTestId('composer-input').fill('still works?');
  const posted = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith(`/api/plans/${id}/messages`),
  );
  await page.getByTestId('composer-input').press('Enter');

  expect((await posted).postDataJSON()).toMatchObject({ kind: 'ask', blockId: 'opt-b', text: 'still works?' });
  await expect(page.locator('[data-block="opt-b"] [data-state="asked"]')).toContainText('Asked');
});
