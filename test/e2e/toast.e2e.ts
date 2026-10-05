import { expect, test } from '@playwright/test';
import { seedPlan } from './support';

const BLOCK = '[data-block="verdict"]';
const ANSWERED = `${BLOCK} [data-state="answered"]`;

const planId = () => `toast-${Date.now()}`;

async function askVerdict(request: Parameters<typeof seedPlan>[0], id: string): Promise<void> {
  await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-ask-toast', kind: 'ask', blockId: 'verdict', text: 'why this pick?' },
  });
}

test('an answer to a block scrolled out of view shows a toast and Show brings the block into view', async ({
  page,
  request,
}) => {
  const id = planId();
  await page.setViewportSize({ width: 1280, height: 600 });
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await askVerdict(request, id);
  await expect(page.locator(`${BLOCK} [data-state="asked"]`)).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(BLOCK)).not.toBeInViewport();

  await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-1', md: 'Because it is simplest.' } });

  const toast = page.getByTestId('toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Recommended has a new answer');

  await page.getByTestId('toast-jump').click();
  await expect(page.locator(BLOCK)).toBeInViewport();
  await expect(page.locator(BLOCK)).toBeFocused();
  await expect(toast).toBeHidden();
});

test('no toast when the answered block is already visible', async ({ page, request }) => {
  const id = planId();
  await page.setViewportSize({ width: 1280, height: 600 });
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await askVerdict(request, id);
  await expect(page.locator(`${BLOCK} [data-state="asked"]`)).toHaveCount(1);
  await page.locator(BLOCK).scrollIntoViewIfNeeded();
  await expect(page.locator(BLOCK)).toBeInViewport();

  await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-1', md: 'Because it is simplest.' } });
  await expect(page.locator(ANSWERED)).toHaveCount(1);
  await expect(page.getByTestId('toast')).toBeHidden();
});

test('Show on an answer to a hidden option switches to its tab', async ({ page, request }) => {
  const id = planId();
  await page.setViewportSize({ width: 1280, height: 600 });
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  const card = page.getByTestId('block-opt-b');
  await expect(card).toBeHidden();

  await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-ask-toast-b', kind: 'ask', blockId: 'opt-b', text: 'why the timer?' },
  });
  await request.post(`/api/plans/${id}/answers`, { data: { questionId: 'm-1', md: 'Because it renews early.' } });

  const toast = page.getByTestId('toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Way B has a new answer');

  await page.getByTestId('toast-jump').click();
  await expect(page.getByTestId('tab-opt-b')).toHaveAttribute('aria-selected', 'true');
  await expect(card).toBeVisible();
  await expect(card).toBeInViewport();
  await expect(card).toBeFocused();
  await expect(page.getByTestId('block-opt-a')).toBeHidden();
  await expect(toast).toBeHidden();
});
