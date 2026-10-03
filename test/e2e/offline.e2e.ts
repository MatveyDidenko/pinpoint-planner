import { expect, test } from '@playwright/test';
import { seedPlan } from './support';

const LOCAL_HOST = '127.0.0.1';
const LOCAL_SCHEMES = new Set(['data:', 'blob:']);
const FONT_FAMILIES = ['IBM Plex Sans', 'IBM Plex Mono', 'Source Serif 4'];

const isLocal = (url: string) => {
  const parsed = new URL(url);
  return LOCAL_SCHEMES.has(parsed.protocol) || parsed.hostname === LOCAL_HOST;
};

test('no request leaves 127.0.0.1', async ({ page, request }) => {
  const id = `offline-${Date.now()}`;
  await seedPlan(request, id);
  const urls: string[] = [];
  page.on('request', (req) => urls.push(req.url()));
  page.on('requestfailed', (req) => urls.push(req.url()));

  await page.goto(`/plans/${id}`);
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('theme-toggle').click();
  await page.locator('[data-block="opt-b"] .option-name').click();
  await page.getByTestId('composer-input').fill('why the timer?');
  await page.getByTestId('composer-input').press('Enter');
  await expect(page.locator('[data-block="opt-b"] [data-state="asked"]')).toContainText('Asked');

  expect(urls.length).toBeGreaterThan(0);
  expect(urls.filter((url) => !isLocal(url))).toEqual([]);
  expect(urls.some((url) => new URL(url).pathname.startsWith('/fonts/'))).toBe(true);
});

test('the fonts are fetched from /fonts and report as loaded', async ({ page, request }) => {
  const id = `offline-fonts-${Date.now()}`;
  await seedPlan(request, id);
  const fontResponses: { path: string; status: number }[] = [];
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    if (pathname.startsWith('/fonts/')) fontResponses.push({ path: pathname, status: res.status() });
  });

  await page.goto(`/plans/${id}`);
  await page.evaluate(async (families) => {
    await Promise.all(families.map((family) => document.fonts.load(`16px "${family}"`)));
    await document.fonts.ready;
  }, FONT_FAMILIES);

  expect(fontResponses.length).toBeGreaterThan(0);
  expect(fontResponses.filter((res) => res.status !== 200)).toEqual([]);
  for (const family of FONT_FAMILIES) {
    expect(await page.evaluate((f) => document.fonts.check(`16px "${f}"`), family)).toBe(true);
    const statuses = await page.evaluate((f) => {
      const found: string[] = [];
      document.fonts.forEach((face) => {
        if (face.family.replaceAll('"', '') === f) found.push(face.status);
      });
      return found;
    }, family);
    expect(statuses).toContain('loaded');
  }
});
