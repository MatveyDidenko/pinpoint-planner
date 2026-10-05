import { optionTabRule } from '../../shared/frames';
import { type Presence, presenceLabel } from '../presence';
import type { Block, OptionBlock, PlanState, PlanSummary } from '../types';
import { renderBlock } from './blocks';
import { attr, esc, jsonScript } from './esc';

export type Assets = { css: string; fontCss: string; js: string };

const WAYS_TITLE: Record<number, string> = { 2: 'Two ways', 3: 'Three ways', 4: 'Four ways' };

const HEAD_META = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';

function documentShell(title: string, assets: Assets, body: string, scripts: string): string {
  return (
    `<!doctype html><html lang="en"><head>${HEAD_META}<title>${esc(title)}</title>` +
    `<style>${assets.fontCss}\n${assets.css}</style></head><body>${body}${scripts}</body></html>`
  );
}

function header(s: PlanState, presence: Presence, undelivered: number): string {
  const handedBack = s.review === 'handed-back';
  return (
    `<header class="plan-header" data-testid="plan-header">` +
    `<div class="plan-header__text"><div class="eyebrow">PINPOINT</div>` +
    `<h1 class="plan-title">${esc(s.plan.title)}</h1><p class="plan-task">${esc(s.plan.task)}</p></div>` +
    `<div class="plan-header__actions">` +
    `<span class="presence" data-testid="presence" data-state="${attr(presence)}"><span class="dot"></span>` +
    `<span class="presence-label">${esc(presenceLabel(presence, undelivered))}</span></span>` +
    `<button type="button" class="done-btn" data-action="done" data-testid="done"${handedBack ? ' disabled' : ''}>Done reviewing</button>` +
    `<button type="button" class="theme-toggle" data-testid="theme-toggle" aria-label="Toggle theme">Theme</button>` +
    `</div></header>`
  );
}

function stage(n: string, title: string, inner: string, hidden = false): string {
  return (
    `<section class="stage" data-stage="${n}" data-testid="stage-${n}"${hidden ? ' hidden' : ''}>` +
    `<h2 class="stage-eyebrow eyebrow">${esc(`${n} · ${title}`)}</h2>${inner}</section>`
  );
}

function optionTab(option: OptionBlock, shown: OptionBlock): string {
  const id = attr(option.id);
  const label = `${option.letter} · ${option.name}`;
  const selected = option === shown;
  const name = option.recommended ? ` aria-label="${attr(`${label} · recommended`)}"` : '';
  const star = option.recommended ? '<span class="option-tab__star" aria-hidden="true">★</span>' : '';
  return (
    `<button type="button" role="tab" class="option-tab" data-option="${id}" data-testid="tab-${id}" aria-controls="block-${id}"` +
    ` aria-selected="${selected}" tabindex="${selected ? 0 : -1}" title="${attr(label)}"${name}>` +
    `<span class="option-tab__label">${esc(label)}</span>${star}</button>`
  );
}

function optionTabs(options: OptionBlock[]): string {
  const shown = options.find((option) => option.recommended);
  if (shown === undefined) return '';
  return (
    `<style id="option-tab-style">${optionTabRule(attr(shown.id))}</style>` +
    `<div class="option-tabs" role="tablist" aria-label="Ways">${options.map((option) => optionTab(option, shown)).join('')}</div>`
  );
}

function renderAll(blocks: Block[], planId: string): string {
  return blocks.map((b) => renderBlock(b, planId)).join('');
}

export function renderPage(
  s: PlanState,
  assets: Assets,
  opts: { presence: Presence; undelivered: number; baseUrl: string },
): string {
  const blocks = s.plan.blocks;
  const ofKind = <K extends Block['kind']>(kind: K) =>
    blocks.filter((b): b is Extract<Block, { kind: K }> => b.kind === kind);
  const hasSteps = ofKind('steps').length > 0;
  const options = ofKind('option');
  const context = ofKind('context');

  const sections: { title: string; inner: string; hidden?: boolean }[] = [
    ...(context.length > 0 ? [{ title: 'How it works today', inner: renderAll(context, s.plan.id) }] : []),
    { title: "What's already here", inner: renderAll(ofKind('findings'), s.plan.id) },
    {
      title: WAYS_TITLE[options.length] ?? `${options.length} ways`,
      inner: `${optionTabs(options)}<div class="options">${renderAll(options, s.plan.id)}</div>`,
    },
    { title: 'The pick', inner: renderAll(ofKind('verdict'), s.plan.id) },
    {
      title: 'Steps',
      inner: `<div class="steps-grid" id="steps-grid">${renderAll(ofKind('steps'), s.plan.id)}</div>`,
      hidden: !hasSteps,
    },
  ];
  const stages = sections
    .map((section, i) => stage(String(i + 1).padStart(2, '0'), section.title, section.inner, section.hidden))
    .join('');

  const body =
    `${header(s, opts.presence, opts.undelivered)}<main class="page" data-testid="page">${stages}` +
    `<div id="composer" data-testid="composer" hidden></div><div id="toast" data-testid="toast" hidden></div></main>`;

  const boot = jsonScript({ planId: s.plan.id, revision: s.revision, presence: opts.presence, review: s.review });
  const scripts = `<script type="application/json" id="pinpoint-boot">${boot}</script><script>${assets.js}</script>`;
  return documentShell(s.plan.title, assets, body, scripts);
}

export function renderHome(plans: PlanSummary[], assets: Assets): string {
  const rows = plans
    .map(
      (p) =>
        `<li class="plan-row"><a class="plan-link" href="${attr(p.url)}" data-testid="plan-link-${attr(p.id)}">${esc(p.title)}</a>` +
        `<span class="plan-meta">r${p.revision} · ${p.pending} pending · ${esc(presenceLabel(p.presence, 0))}</span></li>`,
    )
    .join('');
  const list = plans.length
    ? `<ul class="plan-list" data-testid="plan-list">${rows}</ul>`
    : `<p class="empty" data-testid="home-empty">No plans yet. Ask your agent to open one.</p>`;
  const body = `<main class="page"><div class="eyebrow">PINPOINT</div><h1 class="plan-title">Plans</h1>${list}</main>`;
  return documentShell('Pinpoint', assets, body, '');
}
