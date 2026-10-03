import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Assets, renderHome, renderPage } from '../../src/core/render/page';
import { parsePlanInput, parseStepsInput } from '../../src/core/schema';
import { appendSteps, openPlan } from '../../src/core/state';
import type { PlanState, PlanSummary } from '../../src/core/types';

const NOW = '2026-10-03T10:00:00.000Z';
const assets: Assets = { css: '.page{margin:0}', fontCss: '@font-face{font-family:X}', js: 'window.__pinpoint=1;' };
const opts = { presence: 'waiting' as const, undelivered: 2, baseUrl: 'http://127.0.0.1:4100' };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', name), 'utf8'));
}

function loadState(): PlanState {
  const parsed = parsePlanInput(fixture('plan.auth-refresh.json'));
  if (!parsed.ok) throw new Error('fixture plan is invalid');
  return openPlan(parsed.value, NOW);
}

function withSteps(state: PlanState): PlanState {
  const parsed = parseStepsInput(fixture('steps.opt-a.json'));
  if (!parsed.ok) throw new Error('fixture steps are invalid');
  return appendSteps(state, parsed.value, NOW).state;
}

function bootJson(html: string): unknown {
  const m = html.match(/<script type="application\/json" id="pinpoint-boot">([\s\S]*?)<\/script>/);
  if (!m?.[1]) throw new Error('boot script not found');
  return JSON.parse(m[1]);
}

describe('renderPage', () => {
  it('page contains every block in order, the stage headers and a parsable boot script', () => {
    const state = withSteps(loadState());
    const html = renderPage(state, assets, opts);

    expect(html).toStartWith('<!doctype html>');
    expect(html).toContain(`<title>${state.plan.title}`);
    expect(html).toContain(assets.css);
    expect(html).toContain(assets.fontCss);
    expect(html).toContain(assets.js);

    expect(html).toContain('data-testid="presence" data-state="waiting"');
    expect(html).toContain('Agent not on the line · 2 waiting');
    expect(html).toContain('data-action="done" data-testid="done"');
    expect(html).toContain('data-testid="theme-toggle"');
    expect(html).toContain('id="composer"');
    expect(html).toContain('id="toast"');

    for (const n of ['01', '02', '03', '04']) {
      expect(html).toContain(`data-stage="${n}" data-testid="stage-${n}"`);
    }
    expect(html).toContain('01 · What&#39;s already here');
    expect(html).toContain('02 · Three ways');
    expect(html).toContain('03 · The pick');
    expect(html).toContain('04 · Steps');

    const order = state.plan.blocks.map((b) => html.indexOf(`data-block="${b.id}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    expect(bootJson(html)).toEqual({
      planId: state.plan.id,
      revision: state.revision,
      presence: 'waiting',
      review: 'open',
    });
  });

  it('stage 04 is hidden until a steps block exists', () => {
    const state = loadState();
    const before = renderPage(state, assets, opts);
    const after = renderPage(withSteps(state), assets, opts);

    expect(before).toMatch(/<section class="stage"[^>]*data-stage="04"[^>]*\shidden[\s>]/);
    expect(after).not.toMatch(/<section class="stage"[^>]*data-stage="04"[^>]*\shidden[\s>]/);
    expect(after).toContain('id="steps-grid"');
  });

  it('done is disabled once the review is handed back', () => {
    const state: PlanState = { ...loadState(), review: 'handed-back' };
    const html = renderPage(state, assets, { ...opts, presence: 'handed-back' });

    expect(html).toMatch(/<button[^>]*data-testid="done"[^>]*disabled/);
    expect(bootJson(html)).toMatchObject({ review: 'handed-back' });
  });

  it('boot json containing </script> cannot close the script', () => {
    const state = loadState();
    state.plan.id = 'x</script><img src=x onerror=alert(1)>';
    const html = renderPage(state, assets, opts);

    expect(html).not.toContain('</script><img');
    expect(bootJson(html)).toMatchObject({ planId: state.plan.id });
  });
});

describe('renderHome', () => {
  const plans: PlanSummary[] = [
    {
      id: 'auth-refresh',
      title: 'Refresh <tokens>',
      url: 'http://127.0.0.1:4100/plans/auth-refresh',
      revision: 7,
      pending: 2,
      presence: 'listening',
    },
  ];

  it('lists plans with links, revision, pending count and presence', () => {
    const html = renderHome(plans, assets);

    expect(html).toStartWith('<!doctype html>');
    expect(html).toContain('data-testid="plan-link-auth-refresh"');
    expect(html).toContain('href="http://127.0.0.1:4100/plans/auth-refresh"');
    expect(html).toContain('Refresh &lt;tokens&gt;');
    expect(html).toContain('Agent on the line');
    expect(html).toContain('2 pending');
    expect(html).toContain('r7');
  });

  it('shows an empty state when there are no plans', () => {
    expect(renderHome([], assets)).toContain('data-testid="home-empty"');
  });
});
