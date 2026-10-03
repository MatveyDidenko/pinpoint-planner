import { expect, type Page, test } from '@playwright/test';
import { seedPlan } from './support';

const PLAN_ID = 'theme-e2e';
const DARK_GROUND = 'rgb(18, 21, 27)';

const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.beforeEach(async ({ request }) => {
  await seedPlan(request, PLAN_ID);
});

test('toggle sets html[data-theme=dark], changes the body background and survives reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`/plans/${PLAN_ID}`);
  const before = await bodyBackground(page);

  await page.getByTestId('theme-toggle').click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const after = await bodyBackground(page);
  expect(after).not.toBe(before);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bodyBackground(page)).toBe(after);
});

test('with no stored choice the page follows prefers-color-scheme', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(`/plans/${PLAN_ID}`);

  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  expect(await bodyBackground(page)).toBe(DARK_GROUND);
  await context.close();
});
