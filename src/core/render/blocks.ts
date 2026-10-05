import { renderGraphSvg, renderLegend } from '../diagram/svg';
import { renderMarkdown } from '../markdown';
import type { Block, ContextBlock, Exchange, OptionBlock, StepsBlock, VerdictBlock } from '../types';
import { attr, esc } from './esc';

const EFFORT_WORDS = { S: 'Small', M: 'Medium', L: 'Large' } as const;
const RISK_WORDS = { low: 'Low', medium: 'Medium', high: 'High' } as const;

const OPEN_THREADS = 2;

function isBusy(b: Block): boolean {
  return b.qa.some((x) => x.state !== 'answered') || (b.kind === 'option' && b.steps.state === 'requested');
}

function conversationToggle(b: Block): string {
  if (b.qa.length === 0) return '';
  return (
    `<button type="button" class="qa-toggle" data-action="toggle-qa" data-count="${b.qa.length}" aria-expanded="true" ` +
    `data-testid="qa-toggle-${attr(b.id)}">Hide conversation (${b.qa.length})</button>`
  );
}

function blockShell(b: Block, planId: string, inner: string, modifiers = '', attrs = ''): string {
  const busy = isBusy(b);
  const way = b.kind === 'option' || b.kind === 'steps' ? ` data-way="${b.letter}"` : '';
  const indicator = busy
    ? `<p class="busy" data-testid="busy-${attr(b.id)}"><span class="busy-spinner" aria-hidden="true"></span>The agent is working…</p>`
    : '';
  return (
    `<section class="block block--${b.kind}${modifiers}" id="block-${attr(b.id)}"${attrs} data-block="${attr(b.id)}" ` +
    `data-kind="${b.kind}" data-rev="${b.rev}" data-label="${attr(b.label)}"${way}${busy ? ' data-busy=""' : ''} tabindex="0" ` +
    `data-testid="block-${attr(b.id)}">` +
    `${indicator}${inner}${conversationToggle(b)}` +
    `<div class="qa" data-testid="qa-${attr(b.id)}">${renderThreads(b, planId)}</div>` +
    `</section>`
  );
}

function renderThreads(b: Block, planId: string): string {
  const threads = Array.from(Map.groupBy(b.qa, (x) => x.threadId));
  return threads
    .map(([threadId, exchanges], at) => {
      const t = attr(threadId);
      const inner = exchanges.map((x, i) => renderExchange(x, planId, b.id, i > 0)).join('');
      const answered = exchanges.at(-1)?.state === 'answered';
      const reply = answered
        ? `<button type="button" class="reply-btn" data-action="reply" data-thread="${t}" data-testid="reply-${t}">Reply</button>`
        : '';
      if (!answered || at >= threads.length - OPEN_THREADS) {
        return `<div class="thread" data-thread="${t}" data-testid="thread-${t}">${inner}${reply}</div>`;
      }
      const question = esc(exchanges[0]?.question ?? '');
      return (
        `<details class="thread thread--old" data-thread="${t}" data-testid="thread-${t}">` +
        `<summary class="thread-summary" data-testid="thread-toggle-${t}">` +
        `<span class="asked-line">You asked: ${question}</span>` +
        `<span class="thread-more"><span class="thread-more--show">Show answer</span><span class="thread-more--hide">Hide answer</span></span>` +
        `</summary>${inner}${reply}</details>`
      );
    })
    .join('');
}

export function renderExchange(x: Exchange, planId: string, blockId: string, followup = false): string {
  const followupClass = followup ? ' exchange--followup' : '';
  const open =
    `<div class="exchange exchange--${x.state}${followupClass}" data-testid="qa-${attr(x.id)}" ` +
    `data-state="${x.state}" data-exchange="${attr(x.id)}">`;
  const excerpt = x.excerpt === undefined ? '' : `<blockquote class="excerpt">${esc(x.excerpt)}</blockquote>`;
  const proposal =
    x.proposal === undefined
      ? ''
      : `<figure class="answer-diagram proposal" data-testid="proposal-${attr(x.id)}">` +
        `<figcaption class="eyebrow">YOUR VERSION</figcaption>` +
        `${renderGraphSvg(x.proposal, { markerId: `mk-${blockId}-${x.id}-p`, ariaLabel: 'Your version' })}</figure>`;
  const sketch = x.sketch
    ? `<img class="sketch" alt="Your drawing" src="/api/plans/${attr(planId)}/sketches/${attr(x.id)}.png" data-testid="sketch-${attr(x.id)}">`
    : '';
  const asked = `${open}<p class="asked-line">You asked: ${esc(x.question)}</p>${excerpt}${proposal}${sketch}`;

  if (x.state === 'answered' && x.answer !== undefined) {
    const diagram =
      x.answer.diagram === undefined
        ? ''
        : `<figure class="answer-diagram">${renderGraphSvg(x.answer.diagram, {
            markerId: `mk-${blockId}-${x.id}`,
            ariaLabel: 'Answer diagram',
          })}</figure>`;
    return `${asked}<div class="answer">${renderMarkdown(x.answer.md)}</div>${diagram}</div>`;
  }

  const status = x.state === 'delivered' ? 'The agent is reading' : 'Waiting for the agent';
  return `${asked}<p class="exchange-status">${status}</p></div>`;
}

function renderCost({ id, cost }: OptionBlock): string {
  return (
    `<div class="cost">` +
    `<span class="cost-label" data-testid="cost-${attr(id)}">${EFFORT_WORDS[cost.effort]} effort · ${RISK_WORDS[cost.risk]} risk</span>` +
    `<span class="cost-note">${esc(cost.note)}</span>` +
    `</div>`
  );
}

function renderChooseFooter(b: OptionBlock): string {
  const id = attr(b.id);
  switch (b.steps.state) {
    case 'none':
      return `<button type="button" class="choose-btn" data-action="choose" data-testid="choose-${id}">Choose this way</button>`;
    case 'requested':
      return (
        `<button type="button" class="choose-btn" disabled data-testid="choose-${id}">Choose this way</button>` +
        `<span class="choose-note">Chosen · waiting for steps</span>`
      );
    case 'ready':
      return `<a class="steps-link" href="#block-steps-${id}" data-testid="steps-link-${id}">See steps</a>`;
  }
}

function editButton(b: Block): string {
  return `<button type="button" class="edit-btn" data-action="edit-diagram" data-testid="edit-${attr(b.id)}">Edit diagram</button>`;
}

function renderOption(b: OptionBlock, planId: string): string {
  const chosen = b.steps.state !== 'none';
  const tags = `${b.recommended ? '<span class="ribbon">RECOMMENDED</span>' : ''}${
    chosen ? `<span class="ribbon ribbon--chosen" data-testid="chosen-${attr(b.id)}">Chosen</span>` : ''
  }`;
  const ribbon = tags === '' ? '' : `<div class="ribbons">${tags}</div>`;
  const why = b.recommended && b.why !== undefined ? `<p class="why">${esc(b.why)}</p>` : '';
  const summary =
    b.summary === undefined
      ? ''
      : `<p class="option-summary" data-testid="summary-${attr(b.id)}">${esc(b.summary)}</p>`;
  const chips = b.reuses.map((r) => `<code class="chip">${esc(r)}</code>`).join('');
  const diagram = renderGraphSvg(b.diagram, { markerId: `mk-${b.id}`, ariaLabel: `${b.name} diagram` });
  const inner =
    `${ribbon}` +
    `<header class="option-head">` +
    `<span class="letter">${b.letter}</span>` +
    `<h3 class="option-name">${esc(b.name)}</h3>` +
    `<span class="pattern">${esc(b.pattern)}</span>` +
    `</header>` +
    `${summary}` +
    `<figure class="diagram">${diagram}${renderLegend(b.diagram.nodes.map((n) => n.status))}${editButton(b)}</figure>` +
    `<div class="reuses">${chips}</div>` +
    `${renderCost(b)}` +
    `${why}` +
    `<footer class="choose">${renderChooseFooter(b)}</footer>`;
  const panel = ` role="tabpanel" aria-labelledby="tab-${attr(b.id)}"${chosen ? ' data-chosen=""' : ''}`;
  return blockShell(b, planId, inner, b.recommended ? ' block--recommended' : '', panel);
}

function renderContext(b: ContextBlock, planId: string): string {
  const terms =
    b.terms.length === 0
      ? ''
      : `<dl class="terms">${b.terms.map((t) => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd></div>`).join('')}</dl>`;
  const flows = b.flows
    .map((flow, i) => {
      const diagram =
        flow.diagram === undefined
          ? ''
          : `<figure class="flow-diagram">${renderGraphSvg(flow.diagram, { markerId: `mk-context-${i}`, ariaLabel: `${flow.name} diagram` })}` +
            `${renderLegend(flow.diagram.nodes.map((n) => n.status))}</figure>`;
      const steps = flow.steps.map((step) => `<li>${esc(step)}</li>`).join('');
      return (
        `<section class="flow" data-testid="flow-${i}">` +
        `<h3 class="flow-name">${esc(flow.name)}</h3><ol class="flow-steps">${steps}</ol>${diagram}</section>`
      );
    })
    .join('');
  return blockShell(b, planId, `<p class="context-summary">${esc(b.summary)}</p>${terms}${flows}`);
}

function renderVerdict(b: VerdictBlock, planId: string): string {
  const inner =
    `<div class="verdict">` +
    `<span class="pick-chip">Way ${b.letter}</span>` +
    `<strong class="verdict-name">${esc(b.optionName)}</strong>` +
    `</div>`;
  return blockShell(b, planId, inner);
}

function renderSteps(b: StepsBlock, planId: string): string {
  const items = b.steps
    .map((step) => {
      const touches =
        step.touches.length === 0
          ? ''
          : `<div class="touches">${step.touches.map((t) => `<code class="chip">${esc(t)}</code>`).join('')}</div>`;
      return (
        `<li class="step">` +
        `<p class="step-title">${esc(step.title)}</p>` +
        `${touches}` +
        `<p class="step-test">Test: ${esc(step.test)}</p>` +
        `</li>`
      );
    })
    .join('');
  const inner = `<header class="steps-head"><h3 class="steps-name">${esc(b.label)}</h3></header><ol class="rail">${items}</ol>`;
  return blockShell(b, planId, inner);
}

export function renderBlock(b: Block, planId: string): string {
  switch (b.kind) {
    case 'context':
      return renderContext(b, planId);
    case 'option':
      return renderOption(b, planId);
    case 'verdict':
      return renderVerdict(b, planId);
    case 'steps':
      return renderSteps(b, planId);
  }
}
