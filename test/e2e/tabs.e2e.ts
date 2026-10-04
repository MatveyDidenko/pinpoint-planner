import { expect, type Page, test } from '@playwright/test';
import { seedPlan, showOption } from './support';

async function expectShown(page: Page, shown: string): Promise<void> {
  for (const id of ['opt-a', 'opt-b', 'opt-c']) {
    const tab = page.getByTestId(`tab-${id}`);
    const isShown = id === shown;
    await expect(tab).toHaveAttribute('aria-selected', String(isShown));
    await expect(tab).toHaveAttribute('tabindex', isShown ? '0' : '-1');
    if (isShown) await expect(page.getByTestId(`block-${id}`)).toBeVisible();
    else await expect(page.getByTestId(`block-${id}`)).toBeHidden();
  }
}

test('clicking tab C shows card C and hides the recommended card', async ({ page, request }) => {
  const id = `tabs-click-${Date.now()}`;
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  await expectShown(page, 'opt-a');

  await page.getByTestId('tab-opt-c').click();

  await expectShown(page, 'opt-c');
});

test('arrow keys wrap across tabs and Home and End jump to the ends', async ({ page, request }) => {
  const id = `tabs-keys-${Date.now()}`;
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  await page.getByTestId('tab-opt-a').focus();

  for (const [key, shown] of [
    ['ArrowLeft', 'opt-c'],
    ['ArrowRight', 'opt-a'],
    ['ArrowRight', 'opt-b'],
    ['End', 'opt-c'],
    ['Home', 'opt-a'],
  ] as const) {
    await page.keyboard.press(key);
    await expect(page.getByTestId(`tab-${shown}`)).toBeFocused();
    await expectShown(page, shown);
  }
});

test('a live answer on a hidden option keeps the current tab', async ({ page, request }) => {
  const id = `tabs-live-${Date.now()}`;
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  await showOption(page, 'opt-c');
  await expectShown(page, 'opt-c');

  await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-tabs-0001', kind: 'ask', blockId: 'opt-b', text: 'why the timer?' },
  });
  await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-1', md: 'Because it renews early.' } });
  await expect(page.locator('[data-block="opt-b"] [data-state="answered"]')).toHaveCount(1);

  await expectShown(page, 'opt-c');
});
