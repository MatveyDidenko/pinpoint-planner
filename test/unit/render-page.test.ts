import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Assets, renderHome, renderPage } from '../../src/core/render/page';
import { type PlanInput, parsePlanInput, parseStepsInput } from '../../src/core/schema';
import { appendSteps, openPlan } from '../../src/core/state';
import type { PlanState, PlanSummary } from '../../src/core/types';

const NOW = '2026-10-03T10:00:00.000Z';
const assets: Assets = { css: '.page{margin:0}', fontCss: '@font-face{font-family:X}', js: 'window.__pinpoint=1;' };
const opts = { presence: 'waiting' as const, undelivered: 2, baseUrl: 'http://127.0.0.1:4100' };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', name), 'utf8'));
}

function loadState(optionCount = 3): PlanState {
  const plan = fixture('plan.auth-refresh.json') as PlanInput;
  const [, , last] = plan.options;
  const extra = { ...last, id: 'opt-d' };
  const parsed = parsePlanInput({ ...plan, options: [...plan.options, extra].slice(0, optionCount) });
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

    for (const n of ['01', '02', '03', '04', '05']) {
      expect(html).toContain(`data-stage="${n}" data-testid="stage-${n}"`);
    }
    expect(html).toContain('01 · How it works today');
    expect(html).toContain('02 · What&#39;s already here');
    expect(html).toContain('03 · Three ways');
    expect(html).toContain('04 · The pick');
    expect(html).toContain('05 · Steps');

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

  it('a plan with a context shows How it works today as stage 01', () => {
    const state = loadState();
    const before = renderPage(state, assets, opts);
    const html = renderPage(withSteps(state), assets, opts);

    expect(html).toContain('01 · How it works today');
    expect(html).toContain('02 · What&#39;s already here');
    expect(html).toContain('03 · Three ways');
    expect(html).toContain('04 · The pick');
    expect(html).toContain('05 · Steps');
    expect(html.indexOf('data-stage="01"')).toBeLessThan(html.indexOf('data-block="context"'));
    expect(html.indexOf('data-block="context"')).toBeLessThan(html.indexOf('data-stage="02"'));
    expect(before).toMatch(/<section class="stage"[^>]*data-stage="05"[^>]*\shidden[\s>]/);
    expect(html).not.toMatch(/<section class="stage"[^>]*data-stage="05"[^>]*\shidden[\s>]/);
  });

  it('the ways stage is titled by the option count', () => {
    expect(renderPage(loadState(2), assets, opts)).toContain('03 · Two ways');
    expect(renderPage(loadState(3), assets, opts)).toContain('03 · Three ways');
    expect(renderPage(loadState(4), assets, opts)).toContain('03 · Four ways');
  });

  function tabsOf(html: string): string[] {
    return html.match(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g) ?? [];
  }

  it('the ways stage renders one tab per option and shows only the recommended card', () => {
    const html = renderPage(loadState(), assets, opts);
    const tabs = tabsOf(html);

    expect(tabs).toHaveLength(3);
    expect(html.indexOf('<div class="option-tabs" role="tablist"')).toBeLessThan(html.indexOf('<div class="options">'));
    expect(html).toContain(
      '<style id="option-tab-style">.options > .block--option:not([data-block="opt-a"]){display:none}</style>',
    );
    for (const [i, id] of ['opt-a', 'opt-b', 'opt-c'].entries()) {
      expect(tabs[i]).toContain(`data-testid="tab-${id}"`);
      expect(tabs[i]).toContain(`aria-controls="block-${id}"`);
      expect(tabs[i]).toContain(i === 0 ? 'aria-selected="true" tabindex="0"' : 'aria-selected="false" tabindex="-1"');
    }
    expect(tabs[0]).toContain('title="A · Refresh inside the fetch wrapper"');
    expect(tabs[0]).toContain('★');
    expect(tabs[1]).toContain('>B · Proactive refresh timer<');
    expect(tabs.slice(1).some((tab) => tab.includes('★'))).toBe(false);

    const state = loadState();
    for (const block of state.plan.blocks) {
      if (block.kind === 'option') block.recommended = block.id === 'opt-b';
    }
    const flipped = renderPage(state, assets, opts);
    expect(flipped).toContain('.block--option:not([data-block="opt-b"]){display:none}');
    expect(tabsOf(flipped)[1]).toContain('aria-selected="true" tabindex="0"');
    expect(tabsOf(flipped)[1]).toContain('★');
  });

  it('a tab label with markup is escaped', () => {
    const state = loadState();
    const optA = state.plan.blocks.find((block) => block.id === 'opt-a');
    if (optA?.kind === 'option') optA.name = '<b>"x"</b>';
    const tab = tabsOf(renderPage(state, assets, opts))[0] ?? '';

    expect(tab).not.toContain('<b>');
    expect(tab).toContain('title="A · &lt;b&gt;&quot;x&quot;&lt;/b&gt;"');
    expect(tab).toContain('>A · &lt;b&gt;&quot;x&quot;&lt;/b&gt;<');
  });

  it('the steps stage is hidden until a steps block exists', () => {
    const state = loadState();
    const before = renderPage(state, assets, opts);
    const after = renderPage(withSteps(state), assets, opts);

    expect(before).toMatch(/<section class="stage"[^>]*data-stage="05"[^>]*\shidden[\s>]/);
    expect(after).not.toMatch(/<section class="stage"[^>]*data-stage="05"[^>]*\shidden[\s>]/);
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
