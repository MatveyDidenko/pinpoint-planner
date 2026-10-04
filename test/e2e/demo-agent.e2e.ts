import { type ChildProcess, spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { seedPlan } from './support';

const planId = () => `demo-agent-${Date.now()}`;

interface DemoAgent {
  child: ChildProcess;
  exitCode: () => number | null;
  stderr: () => string;
}

function startDemoAgent(id: string): DemoAgent {
  const child = spawn('mise', ['x', '--', 'bun', 'scripts/demo-agent.ts', id, '--once'], {
    env: { ...process.env, PINPOINT_PORT: '4790', PINPOINT_NO_OPEN: '1', PINPOINT_STATE_DIR: '.e2e-state' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let exitCode: number | null = null;
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.on('exit', (code) => {
    exitCode = code ?? -1;
  });
  return { child, exitCode: () => exitCode, stderr: () => stderr };
}

test.setTimeout(30_000);

test('a question typed in the browser is answered in place by the demo agent running the real CLI', async ({
  page,
  request,
}) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  const agent = startDemoAgent(id);

  try {
    await page.locator('[data-block="opt-b"] .option-name').click();
    await page.getByTestId('composer-input').fill('why the timer?');
    await page.getByTestId('composer-input').press('Enter');

    const answered = page.locator('[data-block="opt-b"] [data-state="answered"]');
    await expect(answered).toContainText('Short answer from the demo agent', { timeout: 15_000 });
    await expect.poll(agent.exitCode, { timeout: 10_000, message: agent.stderr() }).toBe(0);
  } finally {
    agent.child.kill();
  }
});

test('a follow-up is answered in the same thread by the demo agent', async ({ page, request }) => {
  const id = planId();
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  const firstRound = startDemoAgent(id);

  try {
    await page.locator('[data-block="opt-b"] .option-name').click();
    await page.getByTestId('composer-input').fill('why the timer?');
    await page.getByTestId('composer-input').press('Enter');

    const first = page.locator('[data-testid="thread-m-1"] [data-state="answered"]');
    await expect(first).toContainText('Short answer from the demo agent', { timeout: 15_000 });
    await expect(first).not.toContainText('Follow-up');
    await expect.poll(firstRound.exitCode, { timeout: 10_000, message: firstRound.stderr() }).toBe(0);
  } finally {
    firstRound.child.kill();
  }

  const secondRound = startDemoAgent(id);
  try {
    await page.getByTestId('reply-m-1').click();
    await page.getByTestId('composer-input').fill('and when the laptop wakes?');
    await page.getByTestId('composer-input').press('Enter');

    const followup = page.locator('[data-testid="thread-m-1"] .exchange--followup[data-state="answered"]');
    await expect(followup).toContainText('Follow-up 2 in this thread:', { timeout: 15_000 });
    await expect.poll(secondRound.exitCode, { timeout: 10_000, message: secondRound.stderr() }).toBe(0);
  } finally {
    secondRound.child.kill();
  }
});

test('choosing in the browser makes the demo agent append steps that appear in stage 04', async ({ page, request }) => {
  const id = planId();
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedPlan(request, id);
  await page.goto(`/plans/${id}`);
  const agent = startDemoAgent(id);

  try {
    await page.getByTestId('choose-opt-a').click();

    await expect(page.locator('[data-block="steps-opt-a"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('stage-04')).toBeVisible();
    await expect(page.getByTestId('steps-link-opt-a')).toBeVisible();
    await expect.poll(agent.exitCode, { timeout: 10_000, message: agent.stderr() }).toBe(0);
  } finally {
    agent.child.kill();
  }
});
