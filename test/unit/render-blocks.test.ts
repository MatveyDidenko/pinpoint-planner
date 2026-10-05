import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBlock, renderExchange } from '../../src/core/render/blocks';
import { esc } from '../../src/core/render/esc';
import { type Graph, parseAnswerInput, parsePlanInput, parseStepsInput } from '../../src/core/schema';
import {
  appendSteps,
  attachAnswer,
  findBlock,
  markDelivered,
  openPlan,
  patchBlock,
  postMessage,
} from '../../src/core/state';
import type {
  ContextBlock,
  Exchange,
  FindingsBlock,
  OptionBlock,
  PlanState,
  StepsBlock,
  VerdictBlock,
} from '../../src/core/types';

function loadState(): PlanState {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));
  const parsed = parsePlanInput(raw);
  if (!parsed.ok) throw new Error('fixture plan is invalid');
  return openPlan(parsed.value, '2026-10-03T10:00:00.000Z');
}

const state = loadState();
const PLAN = state.plan.id;

function option(id: string, patch: Partial<OptionBlock> = {}): OptionBlock {
  return { ...(findBlock(state, id) as OptionBlock), ...patch };
}

describe('renderBlock option', () => {
  it('option block carries the block contract attributes and its data-testids', () => {
    const b = option('opt-b');
    const html = renderBlock(b, PLAN);

    expect(html).toStartWith('<section class="block block--option"');
    expect(html).toContain('id="block-opt-b"');
    expect(html).toContain('data-block="opt-b"');
    expect(html).toContain('data-kind="option"');
    expect(html).toContain(`data-rev="${b.rev}"`);
    expect(html).toContain(`data-label="Way B · ${b.name}"`);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-testid="block-opt-b"');
    expect(html).not.toContain('data-action="ask"');
    expect(html).toContain('<div class="qa" data-testid="qa-opt-b"></div>');
    expect(html).toContain(b.pattern);
    expect(html).toContain('id="mk-opt-b"');
    for (const reuse of b.reuses) expect(html).toContain(`<code class="chip">${reuse}</code>`);
    expect(html).toContain(b.cost.note);
    expect(html).toContain('<ul class="legend">');
  });

  it('escapes agent strings in attributes and text', () => {
    const html = renderBlock(option('opt-b', { name: '<b>"x"</b>', label: 'Way B · <b>"x"</b>' }), PLAN);

    expect(html).not.toContain('<b>"x"</b>');
    expect(html).toContain('data-label="Way B · &lt;b&gt;&quot;x&quot;&lt;/b&gt;"');
  });

  it('only the recommended option renders the ribbon and why', () => {
    const recommended = option('opt-a');
    const other = option('opt-b');

    const withRibbon = renderBlock(recommended, PLAN);
    expect(withRibbon).toContain('RECOMMENDED');
    expect(withRibbon).toContain(recommended.why as string);
    expect(withRibbon).toContain('block--recommended');

    const without = renderBlock(other, PLAN);
    expect(without).not.toContain('RECOMMENDED');
    expect(without).not.toContain('class="why"');
    expect(without).not.toContain('block--recommended');
  });

  it('choose footer renders button, disabled notice or steps link by steps.state', () => {
    const none = renderBlock(option('opt-b'), PLAN);
    expect(none).toMatch(/<button(?![^>]*disabled)[^>]*data-action="choose"[^>]*data-testid="choose-opt-b"/);
    expect(none).not.toContain('Chosen');
    expect(none).not.toContain('data-busy');
    expect(none).not.toContain('steps-link-opt-b');

    const requested = renderBlock(option('opt-b', { steps: { state: 'requested' } }), PLAN);
    expect(requested).toMatch(
      /<button[^>]*disabled[^>]*data-testid="choose-opt-b"|<button[^>]*data-testid="choose-opt-b"[^>]*disabled/,
    );
    expect(requested).toContain('Chosen · waiting for steps');
    expect(requested).toContain('data-testid="chosen-opt-b">Chosen</span>');
    expect(requested).toContain('data-busy=""');
    expect(requested).not.toContain('steps-link-opt-b');

    const ready = renderBlock(option('opt-b', { steps: { state: 'ready', blockId: 'steps-opt-b' } }), PLAN);
    expect(ready).toContain('href="#block-steps-opt-b"');
    expect(ready).toContain('data-testid="steps-link-opt-b"');
    expect(ready).toContain('See steps');
    expect(ready).toContain('data-chosen=""');
    expect(ready).not.toContain('data-busy');
    expect(ready).not.toContain('data-action="choose"');
  });

  it('cost spells out effort and risk in words', () => {
    const medium = renderBlock(option('opt-b'), PLAN);
    const small = renderBlock(option('opt-a'), PLAN);

    expect(medium).toContain('<span class="cost-label" data-testid="cost-opt-b">Medium effort · Medium risk</span>');
    expect(small).toContain('<span class="cost-label" data-testid="cost-opt-a">Small effort · Low risk</span>');
    expect(medium).not.toContain('class="pip');
    expect(medium).not.toContain('aria-label="Effort');
    expect(medium).not.toContain('aria-label="Risk');
  });

  it('a high-risk large option reads Large effort · High risk', () => {
    const b = option('opt-c', { cost: { ...option('opt-c').cost, effort: 'L', risk: 'high' } });

    expect(renderBlock(b, PLAN)).toContain('data-testid="cost-opt-c">Large effort · High risk</span>');
  });

  it('an option with a summary renders it between header and diagram', () => {
    const html = renderBlock(option('opt-b', { summary: 'A timer renews the <token> early.' }), PLAN);
    const at = html.indexOf(
      '<p class="option-summary" data-testid="summary-opt-b">A timer renews the &lt;token&gt; early.</p>',
    );

    expect(at).toBeGreaterThan(html.indexOf('</header>'));
    expect(at).toBeLessThan(html.indexOf('<figure class="diagram">'));
    const { summary: _summary, ...bare } = option('opt-b');
    expect(renderBlock(bare, PLAN)).not.toContain('option-summary');
  });

  it('renderBlock is deterministic', () => {
    const b = option('opt-a');

    expect(renderBlock(b, PLAN)).toBe(renderBlock(b, PLAN));
    expect(renderBlock(b, PLAN)).toMatchSnapshot();
  });
});

function verdict(s: PlanState = state): VerdictBlock {
  return findBlock(s, 'verdict') as VerdictBlock;
}

describe('renderBlock verdict', () => {
  it('verdict names the recommended way without repeating its why', () => {
    const b = verdict();
    const html = renderBlock(b, PLAN);

    expect(html).toStartWith('<section class="block block--verdict"');
    expect(html).toContain('data-kind="verdict"');
    expect(html).toContain('data-testid="block-verdict"');
    expect(html).toContain('<div class="qa" data-testid="qa-verdict"></div>');
    expect(html).toContain('<span class="pick-chip">Way A</span>');
    expect(html).toContain(`<strong class="verdict-name">${esc(b.optionName)}</strong>`);
    expect(html).not.toContain('class="why"');
  });

  it('verdict escapes a why containing markup', () => {
    const patched = patchBlock(
      state,
      'verdict',
      { kind: 'verdict', why: '<img src=x onerror=alert(1)>' },
      '2026-10-03T10:01:00.000Z',
    ).state;
    const html = renderBlock(verdict(patched), PLAN);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });
});

function findings(patch: Partial<FindingsBlock> = {}): FindingsBlock {
  return { ...(findBlock(state, 'findings') as FindingsBlock), ...patch };
}

describe('renderBlock findings', () => {
  it('findings block lists every item with its role tag and path', () => {
    const b = findings();
    const html = renderBlock(b, PLAN);

    expect(html).toStartWith('<section class="block block--findings"');
    expect(html).toContain('data-kind="findings"');
    expect(html).toContain('<div class="qa" data-testid="qa-findings"></div>');
    expect(html).toContain('id="mk-findings"');
    expect(html).toContain('class="legend"');
    expect(html.match(/<li data-role="/g)?.length).toBe(b.items.length);
    for (const item of b.items) {
      expect(html).toContain(`<code class="path">${item.path}</code>`);
      expect(html).toContain(`<li data-role="${item.role}"`);
      expect(html).toContain(`<span class="role role--${item.role}">${item.role.toUpperCase()}</span>`);
      expect(html).toContain(esc(item.note));
    }
    expect(html).toContain(`<p class="findings-summary">${esc(b.summary)}</p><figure`);
  });

  it('findings without a diagram renders no svg and no legend', () => {
    const { diagram: _diagram, ...rest } = findings();
    const html = renderBlock(rest, PLAN);

    expect(html).not.toContain('<svg');
    expect(html).not.toContain('class="legend"');
    expect(html).not.toContain('<figure');
    expect(html.match(/<li data-role="/g)?.length).toBe(rest.items.length);
  });

  it('escapes agent strings in findings rows and summary', () => {
    const html = renderBlock(
      findings({ summary: '<i>s</i>', items: [{ path: '<a>.ts', role: 'reuse', note: '"n" & <b>' }] }),
      PLAN,
    );

    expect(html).not.toContain('<a>.ts');
    expect(html).not.toContain('<i>s</i>');
    expect(html).toContain('&lt;a&gt;.ts');
    expect(html).toContain('&quot;n&quot; &amp; &lt;b&gt;');
  });
});

describe('renderBlock context', () => {
  it("context renders the summary, every term and each flow's steps in order", () => {
    const graph: Graph = { nodes: [{ id: 'wrapper', label: 'Fetch wrapper', status: 'reused' }], edges: [] };
    const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));
    const parsed = parsePlanInput({
      ...raw,
      context: {
        summary: 'Every request <passes> through one wrapper.',
        terms: [
          { term: '401', meaning: 'The status the API returns for an expired token.' },
          { term: 'refresh token', meaning: 'A long-lived token that buys a new access token.' },
        ],
        flows: [
          { name: 'A normal request', steps: ['The request goes out.', 'The answer comes back.'] },
          { name: 'An expired token', steps: ['The API says 401.', 'The user is logged out.'], diagram: graph },
        ],
      },
    });
    if (!parsed.ok) throw new Error('context plan is invalid');
    const b = findBlock(openPlan(parsed.value, '2026-10-03T10:00:00.000Z'), 'context') as ContextBlock;
    const html = renderBlock(b, PLAN);

    expect(html).toStartWith('<section class="block block--context"');
    expect(html).toContain('<div class="qa" data-testid="qa-context"></div>');
    expect(html).toContain('<p class="context-summary">Every request &lt;passes&gt; through one wrapper.</p>');
    expect(html).toContain('<dl class="terms">');
    for (const t of b.terms) expect(html).toContain(`<dt>${t.term}</dt><dd>${t.meaning}</dd>`);
    const steps = b.flows.flatMap((f) => f.steps).map((step) => html.indexOf(`<li>${step}</li>`));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((x, y) => x - y)).toEqual(steps);
    expect(html.indexOf('data-testid="flow-0"')).toBeLessThan(html.indexOf('data-testid="flow-1"'));
    expect(html).not.toContain('id="mk-context-0"');
    expect(html).toContain('id="mk-context-1"');
    expect(html).toContain('class="legend"');
    expect(html).not.toContain('data-action="edit-diagram"');
  });
});

const ASKED_AT = '2026-10-03T10:05:00.000Z';

function askedState(): PlanState {
  return postMessage(
    state,
    { clientId: 'client-01', kind: 'ask', blockId: 'opt-b', text: 'Why a <timer>?', excerpt: 'Background "renewal"' },
    ASKED_AT,
  ).state;
}

function answerFixture() {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'answer.opt-b.json'), 'utf8'));
  const parsed = parseAnswerInput(raw);
  if (!parsed.ok) throw new Error('fixture answer is invalid');
  return parsed.value;
}

function exchangeOf(s: PlanState): Exchange {
  const x = (findBlock(s, 'opt-b') as OptionBlock).qa[0];
  if (x === undefined) throw new Error('no exchange');
  return x;
}

describe('renderExchange', () => {
  it('exchange renders asked, delivered and answered states with the question and excerpt', () => {
    const asked = askedState();
    const askedHtml = renderExchange(exchangeOf(asked), PLAN, 'opt-b');
    expect(askedHtml).toContain('data-testid="qa-m-1"');
    expect(askedHtml).toContain('data-state="asked"');
    expect(askedHtml).toContain('You asked: Why a &lt;timer&gt;?</p>');
    expect(askedHtml).toContain('<p class="exchange-status">Waiting for the agent</p>');
    expect(askedHtml).toContain('<blockquote class="excerpt">Background &quot;renewal&quot;</blockquote>');
    expect(askedHtml).not.toContain('class="answer"');

    const delivered = markDelivered(asked, ['m-1'], ASKED_AT).state;
    const deliveredHtml = renderExchange(exchangeOf(delivered), PLAN, 'opt-b');
    expect(deliveredHtml).toContain('data-state="delivered"');
    expect(deliveredHtml).toContain('<p class="exchange-status">The agent is reading</p>');

    const answered = attachAnswer(delivered, answerFixture(), ASKED_AT).state;
    const answeredHtml = renderExchange(exchangeOf(answered), PLAN, 'opt-b');
    expect(answeredHtml).toContain('data-state="answered"');
    expect(answeredHtml).toContain('Why a &lt;timer&gt;?');
    expect(answeredHtml).toContain('<strong>sleeping laptop</strong>');
    expect(answeredHtml).toContain('<blockquote class="excerpt">Background &quot;renewal&quot;</blockquote>');
    expect(answeredHtml).not.toContain('exchange-status');

    const blockHtml = renderBlock(findBlock(answered, 'opt-b') as OptionBlock, PLAN);
    expect(blockHtml).toContain('data-testid="qa-m-1"');
    expect(blockHtml).toContain('data-testid="qa-opt-b"');
  });

  it('an answered exchange with a diagram uses a marker id scoped to the exchange', () => {
    const answered = attachAnswer(askedState(), answerFixture(), ASKED_AT).state;
    const html = renderExchange(exchangeOf(answered), PLAN, 'opt-b');

    expect(html).toContain('<figure class="answer-diagram">');
    expect(html).toContain('id="mk-opt-b-m-1"');
    expect(html).not.toContain('id="mk-opt-b"');

    const plain = exchangeOf(askedState());
    const withoutDiagram: Exchange = {
      ...plain,
      state: 'answered',
      answer: { md: 'Short answer.', at: ASKED_AT },
    };
    expect(renderExchange(withoutDiagram, PLAN, 'opt-b')).not.toContain('<figure');
  });

  const proposal: Graph = {
    nodes: [
      { id: 'timer', label: 'Refresh timer', status: 'new' },
      { id: 'cache', label: 'Cache', status: 'new' },
    ],
    edges: [{ from: 'timer', to: 'cache' }],
  };

  function askedWithProposal(): PlanState {
    return postMessage(
      state,
      { clientId: 'client-01', kind: 'ask', blockId: 'opt-b', text: 'Like this?', proposal },
      ASKED_AT,
    ).state;
  }

  it('an exchange with a proposal renders Your version after the question', () => {
    const asked = askedWithProposal();
    const delivered = markDelivered(asked, ['m-1'], ASKED_AT).state;
    const answered = attachAnswer(delivered, { questionId: 'm-1', md: 'It would work.' }, ASKED_AT).state;

    for (const s of [asked, delivered, answered]) {
      const html = renderExchange(exchangeOf(s), PLAN, 'opt-b');
      expect(html).toContain(
        '<figure class="answer-diagram proposal" data-testid="proposal-m-1"><figcaption class="eyebrow">YOUR VERSION</figcaption><svg ',
      );
      expect(html).toContain('<marker id="mk-opt-b-m-1-p"');
      expect(html).toContain('data-node-label="Cache"');
      expect(html.indexOf('data-testid="proposal-m-1"')).toBeGreaterThan(html.indexOf('You asked:'));
    }
    expect(renderExchange(exchangeOf(askedState()), PLAN, 'opt-b')).not.toContain('proposal');
  });

  it('an answered exchange with a proposal and an answer diagram uses two distinct marker ids', () => {
    const answered = attachAnswer(askedWithProposal(), answerFixture(), ASKED_AT).state;
    const html = renderExchange(exchangeOf(answered), PLAN, 'opt-b');

    expect(html.match(/<marker id="mk-opt-b-m-1-p"/g)).toHaveLength(1);
    expect(html.match(/<marker id="mk-opt-b-m-1"/g)).toHaveLength(1);
    expect(html.match(/marker-end="url\(#mk-opt-b-m-1-p\)"/g)).toHaveLength(proposal.edges.length);
    expect(html.match(/marker-end="url\(#mk-opt-b-m-1\)"/g)).toHaveLength(answerFixture().diagram?.edges.length ?? -1);
  });

  function askedWithSketch(): PlanState {
    const sketch = 'data:image/png;base64,iVBORw0KGgo=';
    return postMessage(
      state,
      { clientId: 'client-01', kind: 'ask', blockId: 'opt-b', text: 'Like this?', sketch },
      ASKED_AT,
    ).state;
  }

  it('an exchange with a sketch renders the image after the question', () => {
    const img =
      '<img class="sketch" alt="Your drawing" src="/api/plans/auth-refresh/sketches/m-1.png" data-testid="sketch-m-1">';
    const asked = askedWithSketch();
    const answered = attachAnswer(asked, { questionId: 'm-1', md: 'It would work.' }, ASKED_AT).state;

    for (const s of [asked, answered]) {
      const html = renderExchange(exchangeOf(s), PLAN, 'opt-b');
      expect(html).toContain(img);
      expect(html.indexOf(img)).toBeGreaterThan(html.indexOf('You asked:'));
    }
    expect(renderBlock(findBlock(asked, 'opt-b') as OptionBlock, PLAN)).toContain(img);
  });

  it('an exchange without a sketch renders no img', () => {
    expect(renderExchange(exchangeOf(askedState()), PLAN, 'opt-b')).not.toContain('<img');
    expect(renderBlock(findBlock(askedState(), 'opt-b') as OptionBlock, PLAN)).not.toContain('<img');
  });
});

function ask(s: PlanState, clientId: string, text: string, threadId?: string): PlanState {
  const message = { clientId, kind: 'ask' as const, blockId: 'opt-b', text, ...(threadId ? { threadId } : {}) };
  return postMessage(s, message, ASKED_AT).state;
}

function answer(s: PlanState, questionId: string): PlanState {
  return attachAnswer(s, { questionId, md: `Answer to ${questionId}.` }, ASKED_AT).state;
}

function optB(s: PlanState): string {
  return renderBlock(findBlock(s, 'opt-b') as OptionBlock, PLAN);
}

describe('renderBlock threads', () => {
  it('exchanges render grouped by thread in ask order', () => {
    let s = ask(state, 'c-1', 'first thread');
    s = ask(s, 'c-2', 'second thread');
    s = answer(s, 'm-1');
    s = ask(s, 'c-3', 'follow-up on first', 'm-1');
    const html = optB(s);

    expect(html.match(/<div class="thread"/g)?.length).toBe(2);
    const order = [
      '<div class="thread" data-thread="m-1" data-testid="thread-m-1">',
      'data-testid="qa-m-1"',
      'data-testid="qa-m-3"',
      '<div class="thread" data-thread="m-2" data-testid="thread-m-2">',
      'data-testid="qa-m-2"',
    ].map((needle) => html.indexOf(needle));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('<div class="exchange exchange--answered" data-testid="qa-m-1"');
    expect(html).toContain('<div class="exchange exchange--asked exchange--followup" data-testid="qa-m-3"');
    expect(html).toContain('<div class="exchange exchange--asked" data-testid="qa-m-2"');
  });

  it('only a thread whose last exchange is answered carries a Reply button', () => {
    let s = ask(state, 'c-1', 'answered thread');
    s = ask(s, 'c-2', 'asked thread');
    s = ask(s, 'c-3', 'delivered thread');
    s = markDelivered(s, ['m-3'], ASKED_AT).state;
    s = answer(s, 'm-1');
    const html = optB(s);

    const button =
      '<button type="button" class="reply-btn" data-action="reply" data-thread="m-1" data-testid="reply-m-1">Reply</button>';
    expect(html).toContain(button);
    expect(html.indexOf(button)).toBeGreaterThan(html.indexOf('data-testid="qa-m-1"'));
    expect(html.indexOf(button)).toBeLessThan(html.indexOf('data-testid="thread-m-2"'));
    expect(html.match(/class="reply-btn"/g)?.length).toBe(1);
    expect(html).not.toContain('data-testid="reply-m-2"');
    expect(html).not.toContain('data-testid="reply-m-3"');
  });

  it('a thread waiting on a follow-up has no Reply button', () => {
    let s = answer(ask(state, 'c-1', 'first'), 'm-1');
    s = ask(s, 'c-2', 'follow-up', 'm-1');
    expect(optB(s)).not.toContain('class="reply-btn"');

    const html = optB(answer(s, 'm-2'));
    expect(html.match(/class="reply-btn"/g)?.length).toBe(1);
    expect(html.indexOf('data-testid="reply-m-1"')).toBeGreaterThan(html.indexOf('data-testid="qa-m-2"'));
  });

  it('a block with no exchanges still renders an empty qa', () => {
    const html = optB(state);

    expect(html).toContain('<div class="qa" data-testid="qa-opt-b"></div>');
    expect(html).not.toContain('class="thread"');
  });
});

function stepsInput() {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'steps.opt-a.json'), 'utf8'));
  const parsed = parseStepsInput(raw);
  if (!parsed.ok) throw new Error('fixture steps are invalid');
  return parsed.value;
}

function stepsBlock(patch: Partial<StepsBlock> = {}): StepsBlock {
  const next = appendSteps(state, stepsInput(), '2026-10-03T10:02:00.000Z').state;
  return { ...(findBlock(next, 'steps-opt-a') as StepsBlock), ...patch };
}

describe('renderBlock steps', () => {
  it('steps block numbers every step and lists its touches', () => {
    const b = stepsBlock();
    const html = renderBlock(b, PLAN);

    expect(html).toStartWith('<section class="block block--steps"');
    expect(html).toContain('id="block-steps-opt-a"');
    expect(html).not.toContain('id="steps-opt-a"');
    expect(html).toContain('data-kind="steps"');
    expect(html).toContain('data-testid="block-steps-opt-a"');
    expect(html).toContain('<div class="qa" data-testid="qa-steps-opt-a"></div>');
    expect(html).toContain(`${esc(b.label)}</h3>`);
    expect(html).toContain(`Steps · Way A · ${esc(b.optionName)}`);
    expect(html).toContain('<ol class="rail">');
    expect(html.match(/<li class="step">/g)?.length).toBe(b.steps.length);
    for (const step of b.steps) {
      expect(html).toContain(`<p class="step-title">${esc(step.title)}</p>`);
      expect(html).toContain(`<p class="step-test">Test: ${esc(step.test)}</p>`);
      for (const touch of step.touches) expect(html).toContain(`<code class="chip">${esc(touch)}</code>`);
    }
    expect(html.match(/<div class="touches">/g)?.length).toBe(b.steps.length);
    expect(html.match(/<code class="chip">/g)?.length).toBe(b.steps.reduce((n, step) => n + step.touches.length, 0));
  });

  it('a step with no touches renders no chip row', () => {
    const base = stepsBlock();
    const [first, ...rest] = base.steps;
    if (first === undefined) throw new Error('fixture has no steps');
    const html = renderBlock({ ...base, steps: [{ ...first, touches: [] }, ...rest] }, PLAN);

    expect(html.match(/<li class="step">/g)?.length).toBe(base.steps.length);
    expect(html.match(/<div class="touches">/g)?.length).toBe(base.steps.length - 1);
    expect(html).toContain(`<p class="step-title">${esc(first.title)}</p>`);
    expect(html).toContain(`<p class="step-test">Test: ${esc(first.test)}</p>`);
  });

  it('escapes agent strings in the steps rail', () => {
    const base = stepsBlock();
    const html = renderBlock(
      {
        ...base,
        steps: [{ title: '<b>t</b>', touches: ['<i>f</i>.ts'], test: '"q" & <u>x</u>' }],
      },
      PLAN,
    );

    expect(html).not.toContain('<b>t</b>');
    expect(html).not.toContain('<i>f</i>');
    expect(html).toContain('&lt;b&gt;t&lt;/b&gt;');
    expect(html).toContain('&lt;i&gt;f&lt;/i&gt;.ts');
    expect(html).toContain('Test: &quot;q&quot; &amp; &lt;u&gt;x&lt;/u&gt;');
  });
});
