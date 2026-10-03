import { expect, type Page, test } from '@playwright/test';
import { seedPlan } from './support';

const planId = () => `keyboard-${Date.now()}`;

const MAX_TABS = 20;

async function tabToBlock(page: Page): Promise<string> {
  for (let presses = 0; presses < MAX_TABS; presses++) {
    await page.keyboard.press('Tab');
    const blockId = await page.evaluate(() => document.activeElement?.getAttribute('data-block') ?? null);
    if (blockId !== null) return blockId;
  }
  throw new Error(`no [data-block] received focus within ${MAX_TABS} Tab presses`);
}

test('Tab to a block, Enter, type, Enter sends without a mouse', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  const blockId = await tabToBlock(page);
  const block = page.locator(`[data-block="${blockId}"]`);
  await page.keyboard.press('Enter');

  await expect(block).toHaveAttribute('data-selected', '');
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeFocused();

  await page.keyboard.type('why this one?');
  const posted = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith(`/api/plans/${id}/messages`),
  );
  await page.keyboard.press('Enter');
  const body = (await posted).postDataJSON();

  expect(body).toMatchObject({ kind: 'ask', blockId, text: 'why this one?' });
  await expect(block.locator('[data-state="asked"]')).toContainText('Asked');
});

test('Enter on a focused choose button chooses instead of opening the composer', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await page.getByTestId('choose-opt-a').focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('composer')).toBeHidden();
  await expect(page.locator('[data-block="opt-a"]')).not.toHaveAttribute('data-selected', '');
  await expect(page.locator('[data-block][data-selected]')).toHaveCount(0);
});

const OPT_B_NODE = '[data-block="opt-b"] [data-node-id="timer"]';
const OPT_B_NAME = '[data-block="opt-b"] .option-name';

function waitForPost(page: Page, id: string) {
  return page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith(`/api/plans/${id}/messages`));
}

test('clicking a diagram node sends its label as the excerpt and the pill shows it', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await page.locator(OPT_B_NODE).click();
  await expect(page.locator('[data-block="opt-b"]')).toHaveAttribute('data-selected', '');
  await expect(page.locator('#composer .composer-excerpt')).toHaveText('Refresh timer');

  await page.getByTestId('composer-input').fill('why a timer?');
  const posted = waitForPost(page, id);
  await page.getByTestId('composer-input').press('Enter');
  const body = (await posted).postDataJSON();

  expect(body).toMatchObject({ kind: 'ask', blockId: 'opt-b', text: 'why a timer?', excerpt: 'Refresh timer' });
  await expect(page.locator('[data-block="opt-b"] [data-state="asked"] .excerpt')).toHaveText('Refresh timer');
});

test('a text selection outside the block is not used as excerpt', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);

  await page.evaluate(() => {
    const task = document.querySelector('.plan-task');
    if (task === null) throw new Error('no .plan-task');
    const range = document.createRange();
    range.selectNodeContents(task);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe('');

  await page.locator(OPT_B_NAME).dispatchEvent('click');
  await expect(page.locator('[data-block="opt-b"]')).toHaveAttribute('data-selected', '');
  await expect(page.locator('#composer .composer-excerpt')).toHaveCount(0);

  await page.getByTestId('composer-input').fill('why this one?');
  const posted = waitForPost(page, id);
  await page.getByTestId('composer-input').press('Enter');
  const body = (await posted).postDataJSON();

  expect(body).not.toHaveProperty('excerpt');
});
