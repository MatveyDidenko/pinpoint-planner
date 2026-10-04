import { expect, test } from '@playwright/test';
import { seedPlan } from './support';

const PLAN_ID = 'renders-e2e';
const DIAGRAMS = '[data-kind="option"] figure.diagram svg';

test.beforeEach(async ({ request }) => {
  await seedPlan(request, PLAN_ID);
});

test('the fixture plan renders three diagrams, one ribbon, the pick and four stage eyebrows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/plans/${PLAN_ID}`);

  await expect(page.locator(DIAGRAMS)).toHaveCount(3);
  await expect(page.locator('.ribbon')).toHaveCount(1);
  await expect(page.locator('.ribbon')).toHaveText('RECOMMENDED');
  await expect(page.locator('[data-kind="verdict"] .pick-chip')).toHaveText('Pick A');

  await expect(page.locator('.stage-eyebrow')).toHaveText([
    "01 · What's already here",
    '02 · Three ways',
    '03 · The pick',
    '04 · Steps',
  ]);
  await expect(page.getByTestId('stage-04')).toBeHidden();

  const boxes = await page.locator('[data-kind="option"]').evaluateAll((cards) =>
    cards.map((card) => {
      const { x, y } = card.getBoundingClientRect();
      return { x, y };
    }),
  );
  expect(boxes).toHaveLength(3);
  expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(1);
  const rows = boxes.map((box) => box.y);
  expect(rows).toEqual([...rows].sort((a, b) => a - b));
  expect(new Set(rows).size).toBe(3);
});

test('no horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/plans/${PLAN_ID}`);
  await expect(page.locator(DIAGRAMS)).toHaveCount(3);

  const overflowing = () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: Array.from(document.querySelectorAll('body *'))
        .filter((el) => !el.parentElement?.closest('figure.diagram'))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    }));

  const first = await overflowing();
  expect(first.offenders).toEqual([]);
  expect(first.scrollWidth).toBeLessThanOrEqual(first.innerWidth);

  await page.locator('[data-block="opt-b"] .option-name').click();
  const composer = page.getByTestId('composer');
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

  const second = await overflowing();
  expect(second.offenders).toEqual([]);
  expect(second.scrollWidth).toBeLessThanOrEqual(second.innerWidth);

  const header = await page.getByTestId('plan-header').boundingBox();
  expect((header?.x ?? 0) + (header?.width ?? 0)).toBeLessThanOrEqual(390);
});
