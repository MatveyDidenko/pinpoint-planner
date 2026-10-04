import { renderGraphSvg, renderLegend } from '../diagram/svg';
import { renderMarkdown } from '../markdown';
import type { Block, Exchange, FindingsBlock, OptionBlock, StepsBlock, VerdictBlock } from '../types';
import { attr, esc } from './esc';

const EFFORT_PIPS = { S: 1, M: 2, L: 3 } as const;
const EFFORT_WORDS = { S: 'Small', M: 'Medium', L: 'Large' } as const;
const RISK_WORDS = { low: 'Low', medium: 'Medium', high: 'High' } as const;
const MAX_PIPS = 3;

function blockShell(b: Block, inner: string, modifiers = ''): string {
  return (
    `<section class="block block--${b.kind}${modifiers}" id="block-${attr(b.id)}" data-block="${attr(b.id)}" ` +
    `data-kind="${b.kind}" data-rev="${b.rev}" data-label="${attr(b.label)}" tabindex="0" ` +
    `data-testid="block-${attr(b.id)}">` +
    `<button type="button" class="ask-btn" data-action="ask" data-testid="ask-${attr(b.id)}">Ask</button>` +
    `${inner}` +
    `<div class="qa" data-testid="qa-${attr(b.id)}">${renderThreads(b)}</div>` +
    `</section>`
  );
}

function renderThreads(b: Block): string {
  return Array.from(
    Map.groupBy(b.qa, (x) => x.threadId),
    ([threadId, exchanges]) => {
      const t = attr(threadId);
      const inner = exchanges.map((x, i) => renderExchange(x, b.id, i > 0)).join('');
      const reply =
        exchanges.at(-1)?.state === 'answered'
          ? `<button type="button" class="reply-btn" data-action="reply" data-thread="${t}" data-testid="reply-${t}">Reply</button>`
          : '';
      return `<div class="thread" data-thread="${t}" data-testid="thread-${t}">${inner}${reply}</div>`;
    },
  ).join('');
}

export function renderExchange(x: Exchange, blockId: string, followup = false): string {
  const followupClass = followup ? ' exchange--followup' : '';
  const open =
    `<div class="exchange exchange--${x.state}${followupClass}" data-testid="qa-${attr(x.id)}" ` +
    `data-state="${x.state}" data-exchange="${attr(x.id)}">`;
  const excerpt = x.excerpt === undefined ? '' : `<blockquote class="excerpt">${esc(x.excerpt)}</blockquote>`;
  const question = esc(x.question);

  if (x.state === 'answered' && x.answer !== undefined) {
    const diagram =
      x.answer.diagram === undefined
        ? ''
        : `<figure class="answer-diagram">${renderGraphSvg(x.answer.diagram, {
            markerId: `mk-${blockId}-${x.id}`,
            ariaLabel: 'Answer diagram',
          })}</figure>`;
    return (
      `${open}${excerpt}<p class="asked-line">You asked: ${question}</p>` +
      `<div class="answer">${renderMarkdown(x.answer.md)}</div>${diagram}</div>`
    );
  }

  const status = x.state === 'delivered' ? 'Delivered to the agent' : 'Asked';
  return `${open}${excerpt}<p class="asked-line">You asked: ${question} · ${status}</p></div>`;
}

function renderCost({ id, cost }: OptionBlock): string {
  const filled = EFFORT_PIPS[cost.effort];
  const pips = Array.from(
    { length: MAX_PIPS },
    (_, i) => `<span class="pip${i < filled ? ' pip--on' : ''}"></span>`,
  ).join('');
  return (
    `<div class="cost">` +
    `<span class="effort" aria-hidden="true">${pips}</span>` +
    `<span class="pip pip--risk" data-risk="${cost.risk}" aria-hidden="true"></span>` +
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
        `<span class="choose-note">Steps requested · waiting for the agent</span>`
      );
    case 'ready':
      return `<a class="steps-link" href="#block-steps-${id}" data-testid="steps-link-${id}">Steps ready ↓</a>`;
  }
}

function renderOption(b: OptionBlock): string {
  const ribbon = b.recommended ? `<span class="ribbon">RECOMMENDED</span>` : '';
  const why = b.recommended && b.why !== undefined ? `<p class="why">${esc(b.why)}</p>` : '';
  const chips = b.reuses.map((r) => `<code class="chip">${esc(r)}</code>`).join('');
  const diagram = renderGraphSvg(b.diagram, { markerId: `mk-${b.id}`, ariaLabel: `${b.name} diagram` });
  const inner =
    `${ribbon}` +
    `<header class="option-head">` +
    `<span class="letter">${b.letter}</span>` +
    `<h3 class="option-name">${esc(b.name)}</h3>` +
    `<span class="pattern">${esc(b.pattern)}</span>` +
    `</header>` +
    `<figure class="diagram">${diagram}</figure>` +
    `<div class="reuses">${chips}</div>` +
    `${renderCost(b)}` +
    `${why}` +
    `<footer class="choose">${renderChooseFooter(b)}</footer>`;
  return blockShell(b, inner, b.recommended ? ' block--recommended' : '');
}

function renderFindings(b: FindingsBlock): string {
  const diagram =
    b.diagram === undefined
      ? ''
      : `<figure class="diagram">${renderGraphSvg(b.diagram, { markerId: 'mk-findings', ariaLabel: 'Existing code diagram' })}` +
        `${renderLegend(b.diagram.nodes.map((n) => n.status))}</figure>`;
  const rows = b.items
    .map(
      (item) =>
        `<li data-role="${item.role}">` +
        `<code class="path">${esc(item.path)}</code>` +
        `<span class="role role--${item.role}">${item.role.toUpperCase()}</span>` +
        `<span class="note">${esc(item.note)}</span>` +
        `</li>`,
    )
    .join('');
  const inner = `${diagram}<ul class="findings">${rows}</ul><p class="caption">${esc(b.summary)}</p>`;
  return blockShell(b, inner);
}

function renderVerdict(b: VerdictBlock): string {
  const inner =
    `<div class="verdict">` +
    `<span class="pick-chip">Pick ${b.letter}</span>` +
    `<strong class="verdict-name">${esc(b.optionName)}</strong>` +
    `<p class="why">${esc(b.why)}</p>` +
    `</div>`;
  return blockShell(b, inner);
}

function renderSteps(b: StepsBlock): string {
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
  return blockShell(b, inner);
}

export function renderBlock(b: Block): string {
  switch (b.kind) {
    case 'option':
      return renderOption(b);
    case 'findings':
      return renderFindings(b);
    case 'verdict':
      return renderVerdict(b);
    case 'steps':
      return renderSteps(b);
  }
}
