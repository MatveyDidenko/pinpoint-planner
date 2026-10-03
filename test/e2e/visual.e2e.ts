import { expect, type Page, test } from '@playwright/test';
import { seedPlan } from './support';

const PLAN_ID = 'visual';
const SNAPSHOT_OPTIONS = { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.02 } as const;

type ColorScheme = 'light' | 'dark';

async function openPlan(page: Page, width: number, colorScheme: ColorScheme) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme });
  await page.goto(`/plans/${PLAN_ID}`);
  await expect(page.locator('[data-kind="option"] figure.diagram svg')).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async ({ request }) => {
  await seedPlan(request, PLAN_ID);
});

test('fixture plan matches its baseline at 1280 light, 1280 dark and 390 light', async ({ page }) => {
  await openPlan(page, 1280, 'light');
  await expect(page).toHaveScreenshot('plan-1280-light.png', SNAPSHOT_OPTIONS);

  await openPlan(page, 1280, 'dark');
  await expect(page).toHaveScreenshot('plan-1280-dark.png', SNAPSHOT_OPTIONS);

  await openPlan(page, 390, 'light');
  await expect(page).toHaveScreenshot('plan-390-light.png', SNAPSHOT_OPTIONS);
});

test('dark and light screenshots differ', async ({ page }) => {
  await openPlan(page, 1280, 'light');
  const light = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  await openPlan(page, 1280, 'dark');
  const dark = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });

  expect(Buffer.compare(light, dark)).not.toBe(0);
});
