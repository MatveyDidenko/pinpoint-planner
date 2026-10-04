import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedPlan, showOption } from './support';

const planId = () => `choose-${Date.now()}`;

const stepsFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/steps.${name}.json`, import.meta.url), 'utf8'));

test('choose A shows Steps requested, steps posted through the api appear in stage 04, choose C lands beside them', async ({
  page,
  request,
}) => {
  const id = planId();
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  await expect(page.getByTestId('stage-04')).toBeHidden();

  await page.getByTestId('choose-opt-a').click();
  await expect(page.locator('[data-block="opt-a"]')).toContainText('Steps requested');
  await expect(page.getByTestId('choose-opt-a')).toBeDisabled();

  await request.post(`/api/plans/${id}/steps`, { data: stepsFixture('opt-a') });
  await expect(page.locator('[data-block="steps-opt-a"]')).toBeVisible();
  await expect(page.getByTestId('stage-04')).toBeVisible();
  await expect(page.getByTestId('steps-link-opt-a')).toBeVisible();
  await expect(page.getByTestId('choose-opt-a')).toHaveCount(0);

  await showOption(page, 'opt-c');
  await page.getByTestId('choose-opt-c').click();
  await expect(page.locator('[data-block="opt-c"]')).toContainText('Steps requested');
  await request.post(`/api/plans/${id}/steps`, { data: stepsFixture('opt-c') });
  await expect(page.locator('[data-kind=steps]')).toHaveCount(2);

  const first = await page.locator('[data-block="steps-opt-a"]').boundingBox();
  const second = await page.locator('[data-block="steps-opt-c"]').boundingBox();
  if (first === null || second === null) throw new Error('steps blocks have no bounding box');
  expect(second.x).toBeGreaterThan(first.x);
  expect(Math.abs(second.y - first.y)).toBeLessThan(20);
});

test('after steps are ready the card shows a Steps ready link and no choose button', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await page.getByTestId('choose-opt-a').click();
  await request.post(`/api/plans/${id}/steps`, { data: stepsFixture('opt-a') });

  const card = page.locator('[data-block="opt-a"]');
  await expect(card.getByTestId('steps-link-opt-a')).toContainText('Steps ready');
  await expect(card.getByTestId('choose-opt-a')).toHaveCount(0);
  await expect(card).not.toContainText('Steps requested');
});

test('reload keeps both steps blocks and both card states', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await page.getByTestId('choose-opt-a').click();
  await request.post(`/api/plans/${id}/steps`, { data: stepsFixture('opt-a') });
  await showOption(page, 'opt-c');
  await page.getByTestId('choose-opt-c').click();
  await request.post(`/api/plans/${id}/steps`, { data: stepsFixture('opt-c') });
  await expect(page.locator('[data-kind=steps]')).toHaveCount(2);

  await page.reload();

  await expect(page.locator('[data-kind=steps]')).toHaveCount(2);
  await expect(page.getByTestId('steps-link-opt-a')).toBeVisible();
  await showOption(page, 'opt-c');
  await expect(page.getByTestId('steps-link-opt-c')).toBeVisible();
  await showOption(page, 'opt-b');
  await expect(page.getByTestId('choose-opt-b')).toBeVisible();
  await expect(page.getByTestId('steps-link-opt-b')).toHaveCount(0);
});
