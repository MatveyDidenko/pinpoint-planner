import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { seedPlan } from './support';

async function openEditor(
  page: Page,
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; editor: Locator }> {
  const id = `sketch-${name}-${Date.now()}`;
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  await page.getByTestId('edit-opt-a').click();
  const editor = page.getByTestId('editor-opt-a');
  await expect(editor).toBeVisible();
  return { id, editor };
}

async function origin(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

async function stroke(page: Page, from: { x: number; y: number }, dx: number, dy: number, steps = 6): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
}

test('drawing adds a stroke and Undo removes it', async ({ page, request }) => {
  const { editor } = await openEditor(page, request, 'undo');
  const marks = editor.locator('polyline.mark');
  const draw = page.getByTestId('draw');
  const svg = await origin(editor.locator('svg'));

  await expect(draw).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('undo-stroke')).toBeDisabled();
  await expect(page.getByTestId('clear-strokes')).toBeDisabled();
  await draw.click();
  await expect(draw).toHaveAttribute('aria-pressed', 'true');
  await stroke(page, { x: svg.x + 10, y: svg.y + 70 }, 120, 30);

  await expect(marks).toHaveCount(1);
  expect((await marks.first().getAttribute('points'))?.split(' ').length).toBeGreaterThan(2);
  expect(await marks.first().evaluate((el) => getComputedStyle(el).stroke)).toBe('rgb(200, 16, 46)');
  await stroke(page, { x: svg.x + 10, y: svg.y + 100 }, 80, -20);
  await expect(marks).toHaveCount(2);

  await page.getByTestId('undo-stroke').click();
  await expect(marks).toHaveCount(1);
  await stroke(page, { x: svg.x + 20, y: svg.y + 110 }, 60, 10);
  await page.getByTestId('clear-strokes').click();
  await expect(marks).toHaveCount(0);
  await expect(page.getByTestId('undo-stroke')).toBeDisabled();
  await expect(page.getByTestId('clear-strokes')).toBeDisabled();
});

test('with Draw on, dragging a box draws instead of moving it', async ({ page, request }) => {
  const { editor } = await openEditor(page, request, 'no-drag');
  const rect = editor.locator('[data-node-id="api"] rect');
  const box = await rect.boundingBox();
  if (box === null) throw new Error('box has no bounds');
  const centre = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };

  await page.getByTestId('draw').click();
  await stroke(page, centre, 80, 40);

  await expect(editor.locator('polyline.mark')).toHaveCount(1);
  await expect(rect).toHaveAttribute('x', '334');
  await expect(rect).toHaveAttribute('y', '76');

  await page.getByTestId('draw').click();
  await stroke(page, centre, 80, 40);
  await expect(rect).toHaveAttribute('x', '414');
  await expect(editor.locator('polyline.mark')).toHaveCount(1);
});

test('a stroke stops at 200 points and the drawing at 50 strokes', async ({ page, request }) => {
  const { editor } = await openEditor(page, request, 'caps');
  const marks = editor.locator('polyline.mark');
  const svg = await origin(editor.locator('svg'));
  await page.getByTestId('draw').click();

  await stroke(page, { x: svg.x + 5, y: svg.y + 70 }, 300, 40, 300);
  await expect(marks).toHaveCount(1);
  expect((await marks.first().getAttribute('points'))?.split(' ').length).toBe(200);

  for (let i = 1; i < 51; i++) await stroke(page, { x: svg.x + 5 + i * 2, y: svg.y + 100 }, 10, 10, 2);
  await expect(marks).toHaveCount(50);
  await expect(page.getByTestId('editor-note')).toHaveText('Drawings hold at most 50 strokes');
});

const postedMessage = (page: Page, id: string) =>
  page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith(`/api/plans/${id}/messages`));

const PNG_PREFIX = 'data:image/png;base64,';

function pngColours(page: Page, src: string): Promise<string[]> {
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return [];
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return [...seen];
  }, src);
}

test('asking with a drawing posts a PNG and the thread shows it', async ({ page, request }) => {
  const { id, editor } = await openEditor(page, request, 'ask');
  const svg = await origin(editor.locator('svg'));
  const svgWidth = Number(await editor.locator('svg').getAttribute('width'));
  const canvas = await editor.locator('.editor-canvas').boundingBox();
  if (canvas === null) throw new Error('canvas has no box');
  await page.getByTestId('draw').click();
  await stroke(page, { x: svg.x + 10, y: svg.y + 70 }, 160, 40);
  await stroke(page, { x: Math.round(canvas.x + canvas.width - 60), y: svg.y + 20 }, 30, 60);

  await page.getByTestId('ask-version').click();
  await expect(page.getByTestId('composer-proposal')).toHaveText('With your drawing');
  await page.getByTestId('composer-input').fill('what about this?');
  const posted = postedMessage(page, id);
  await page.getByTestId('composer-input').press('Enter');
  const body = (await posted).postDataJSON();

  expect(body).toMatchObject({ kind: 'ask', blockId: 'opt-a', text: 'what about this?' });
  expect(body).not.toHaveProperty('proposal');
  expect(body.sketch.startsWith(PNG_PREFIX)).toBe(true);
  const png = Buffer.from(body.sketch.slice(PNG_PREFIX.length), 'base64');
  const pngWidth = png.readUInt32BE(16);
  expect(pngWidth).toBeGreaterThan(2 * svgWidth);
  const colours = await pngColours(page, body.sketch);
  expect(colours).toContain('200,16,46');
  expect(colours).toContain('230,232,247');
  expect(colours).toContain('246,234,218');
  expect(colours).not.toContain('0,0,0');

  const img = page.locator('[data-block="opt-a"] [data-testid^="sketch-"]');
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('alt', 'Your drawing');
  expect(await img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBe(pngWidth);
  await expect(editor).toHaveCount(0);
});

test('asking without strokes sends no sketch', async ({ page, request }) => {
  const { id, editor } = await openEditor(page, request, 'no-strokes');
  const svg = await origin(editor.locator('svg'));
  await page.getByTestId('draw').click();
  await stroke(page, { x: svg.x + 10, y: svg.y + 70 }, 120, 30);
  await page.getByTestId('clear-strokes').click();

  await page.getByTestId('ask-version').click();
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByTestId('composer-proposal')).toBeHidden();
  await page.getByTestId('composer-input').fill('anything wrong here?');
  const posted = postedMessage(page, id);
  await page.getByTestId('composer-input').press('Enter');
  const body = (await posted).postDataJSON();

  expect(body).toMatchObject({ kind: 'ask', blockId: 'opt-a', text: 'anything wrong here?' });
  expect(body).not.toHaveProperty('sketch');
  expect(body).not.toHaveProperty('proposal');
});

test('strokes survive a live answer on the block being edited', async ({ page, request }) => {
  const { id, editor } = await openEditor(page, request, 'live');
  const svg = await origin(editor.locator('svg'));
  await page.getByTestId('draw').click();
  await stroke(page, { x: svg.x + 10, y: svg.y + 70 }, 120, 30);

  const asked = await request.post(`/api/plans/${id}/messages`, {
    data: { clientId: 'e2e-live-sketch-0001', kind: 'ask', blockId: 'opt-a', text: 'why the wrapper?' },
  });
  expect(asked.ok()).toBe(true);

  await expect(page.locator('[data-block="opt-a"] [data-state="asked"]')).toBeVisible();
  await expect(editor.locator('polyline.mark')).toHaveCount(1);
  await expect(page.getByTestId('draw')).toHaveAttribute('aria-pressed', 'true');
});
