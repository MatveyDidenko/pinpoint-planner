import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';

const PLAN_FIXTURE = new URL('../fixtures/plan.auth-refresh.json', import.meta.url);

export async function seedPlan(request: APIRequestContext, id: string): Promise<unknown> {
  const plan = { ...JSON.parse(readFileSync(PLAN_FIXTURE, 'utf8')), id };
  const response = await request.put(`/api/plans/${id}`, { data: plan });
  if (!response.ok()) throw new Error(`seeding plan ${id} failed with ${response.status()}: ${await response.text()}`);
  return response.json();
}

export async function blockHtmlMap(page: Page): Promise<Record<string, string>> {
  return page.$$eval('[data-block]', (blocks) =>
    Object.fromEntries(blocks.map((block) => [block.getAttribute('data-block') ?? '', block.outerHTML])),
  );
}
