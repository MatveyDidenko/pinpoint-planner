import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserMessage, MAX_EXCHANGES, type PlanInput, parsePlanInput } from '../../src/core/schema';
import {
  ackMessages,
  blockLabel,
  findBlock,
  markDelivered,
  openPlan,
  pendingMessages,
  postMessage,
} from '../../src/core/state';
import { type OptionBlock, type PlanState, StateError, type VerdictBlock } from '../../src/core/types';

const NOW = '2026-10-03T10:00:00.000Z';

function loadPlan(): PlanInput {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));
  const parsed = parsePlanInput(raw);
  if (!parsed.ok) throw new Error('fixture plan is invalid');
  return parsed.value;
}

describe('openPlan', () => {
  it('openPlan derives findings, three lettered options and the verdict in order', () => {
    const state = openPlan(loadPlan(), NOW);
    const blocks = state.plan.blocks;

    expect(blocks.map((b) => b.kind)).toEqual(['findings', 'option', 'option', 'option', 'verdict']);
    expect(blocks.map((b) => b.id)).toEqual(['findings', 'opt-a', 'opt-b', 'opt-c', 'verdict']);
    expect(blocks.filter((b): b is OptionBlock => b.kind === 'option').map((b) => b.letter)).toEqual(['A', 'B', 'C']);
    expect(blocks.map(blockLabel)).toEqual([
      "What's already here",
      'Way A · Refresh inside the fetch wrapper',
      'Way B · Proactive refresh timer',
      'Way C · Refresh at each call site',
      'The pick',
    ]);
    expect(blocks.map((b) => b.label)).toEqual(blocks.map(blockLabel));
    expect(blocks.every((b) => b.rev === 1 && b.touchedAt === 1 && b.qa.length === 0)).toBe(true);
    expect(state.schemaVersion).toBe(1);
    expect(state.revision).toBe(1);
    expect(state.nextMessageSeq).toBe(1);
    expect(state.review).toBe('open');
    expect(state.messages).toEqual([]);
    expect(state.plan.openedAt).toBe(NOW);
    expect(findBlock(state, 'opt-b')).toBe(blocks[2]);
    expect(findBlock(state, 'nope')).toBeUndefined();
    expect((blocks[1] as OptionBlock).steps).toEqual({ state: 'none' });
  });

  it('openPlan verdict follows whichever option is recommended', () => {
    const input = loadPlan();
    const why = input.options.find((o) => o.recommended)?.why;
    const options = input.options.map((o) =>
      o.id === 'opt-c' ? { ...o, recommended: true, why } : { ...o, recommended: false, why: undefined },
    );
    const state = openPlan({ ...input, options }, NOW);
    const verdict = findBlock(state, 'verdict') as VerdictBlock;

    expect(verdict.optionId).toBe('opt-c');
    expect(verdict.letter).toBe('C');
    expect(verdict.optionName).toBe('Refresh at each call site');
    expect(verdict.why).toBe(why as string);
    expect((findBlock(state, 'opt-a') as OptionBlock).recommended).toBe(false);
  });
});

function ask(blockId: string, text: string, clientId: string): BrowserMessage {
  return { clientId, kind: 'ask', blockId, text };
}

describe('postMessage ask', () => {
  it('ask adds an asked exchange to the named block and leaves every other block identical', () => {
    const prev = openPlan(loadPlan(), NOW);
    const later = '2026-10-03T10:05:00.000Z';
    const result = postMessage(
      prev,
      { ...ask('opt-b', 'Why a timer?', 'client-01'), excerpt: 'Background renewal' },
      later,
    );
    const next = result.state;

    expect(result.touched).toEqual(['opt-b']);
    expect(result.duplicate).toBe(false);
    expect(result.message).toEqual({
      id: 'm-1',
      clientId: 'client-01',
      kind: 'ask',
      blockId: 'opt-b',
      text: 'Why a timer?',
      excerpt: 'Background renewal',
      at: later,
    });
    expect(next.messages).toEqual([result.message]);
    expect(next.nextMessageSeq).toBe(2);
    expect(next.revision).toBe(2);

    const target = findBlock(next, 'opt-b');
    expect(target?.qa).toEqual([
      { id: 'm-1', question: 'Why a timer?', excerpt: 'Background renewal', askedAt: later, state: 'asked' },
    ]);
    expect(target?.rev).toBe(2);
    expect(target?.touchedAt).toBe(2);

    prev.plan.blocks.forEach((block, i) => {
      if (block.id !== 'opt-b') expect(next.plan.blocks[i]).toBe(block);
    });
    expect(prev.messages).toEqual([]);
    expect(prev.revision).toBe(1);
    expect(findBlock(prev, 'opt-b')?.qa).toEqual([]);
    expect(pendingMessages(next).map((m) => m.id)).toEqual(['m-1']);
  });

  it('ask on an unknown block throws NOT_FOUND', () => {
    const state = openPlan(loadPlan(), NOW);
    let error: unknown;
    try {
      postMessage(state, ask('nope', 'Anyone there?', 'client-01'), NOW);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).code).toBe('NOT_FOUND');
  });

  it('the eleventh ask on one block throws BLOCK_FULL', () => {
    let state = openPlan(loadPlan(), NOW);
    for (let i = 0; i < MAX_EXCHANGES; i++) {
      state = postMessage(state, ask('opt-a', `Question ${i}`, `client-${i}`), NOW).state;
    }
    expect(findBlock(state, 'opt-a')?.qa).toHaveLength(MAX_EXCHANGES);

    let error: unknown;
    try {
      postMessage(state, ask('opt-a', 'One too many', 'client-extra'), NOW);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(StateError);
    expect((error as StateError).code).toBe('BLOCK_FULL');
    expect(state.messages).toHaveLength(MAX_EXCHANGES);
  });
});

describe('postMessage clientId dedupe', () => {
  it('a repeated clientId returns the stored message and the same state object', () => {
    const first = postMessage(openPlan(loadPlan(), NOW), ask('opt-b', 'Why a timer?', 'client-01'), NOW);
    const again = postMessage(first.state, ask('opt-b', 'Why a timer?', 'client-01'), '2026-10-03T10:09:00.000Z');

    expect(again.state).toBe(first.state);
    expect(again.touched).toEqual([]);
    expect(again.message).toBe(first.message);
    expect(again.duplicate).toBe(true);
  });

  it('a repeated clientId with different text still returns the original text', () => {
    const first = postMessage(openPlan(loadPlan(), NOW), ask('opt-b', 'Why a timer?', 'client-01'), NOW);
    const again = postMessage(first.state, ask('opt-b', 'A completely different question', 'client-01'), NOW);

    expect(again.message.text).toBe('Why a timer?');
    expect(again.duplicate).toBe(true);
    expect(again.state.messages).toHaveLength(1);
    expect(findBlock(again.state, 'opt-b')?.qa).toHaveLength(1);
    expect(again.state.revision).toBe(first.state.revision);
  });
});

function choose(optionId: string, clientId: string): BrowserMessage {
  return { clientId, kind: 'choose', optionId, text: '' };
}

function withSteps(state: PlanState, optionId: string, steps: OptionBlock['steps']): PlanState {
  return {
    ...state,
    plan: {
      ...state.plan,
      blocks: state.plan.blocks.map((b) => (b.id === optionId && b.kind === 'option' ? { ...b, steps } : b)),
    },
  };
}

function thrownCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (e) {
    return e instanceof StateError ? e.code : undefined;
  }
  return undefined;
}

describe('postMessage choose', () => {
  it("choose marks the option's steps requested and touches only that option", () => {
    const prev = openPlan(loadPlan(), NOW);
    const later = '2026-10-03T10:05:00.000Z';
    const result = postMessage(prev, choose('opt-a', 'client-01'), later);
    const next = result.state;

    expect(result.touched).toEqual(['opt-a']);
    expect(result.duplicate).toBe(false);
    expect(result.message).toEqual({
      id: 'm-1',
      clientId: 'client-01',
      kind: 'choose',
      blockId: 'opt-a',
      optionId: 'opt-a',
      text: '',
      at: later,
    });
    expect(next.messages).toEqual([result.message]);
    expect(next.nextMessageSeq).toBe(2);
    expect(next.revision).toBe(2);

    const target = findBlock(next, 'opt-a') as OptionBlock;
    expect(target.steps).toEqual({ state: 'requested' });
    expect(target.rev).toBe(2);
    expect(target.touchedAt).toBe(2);
    expect(target.qa).toEqual([]);

    prev.plan.blocks.forEach((block, i) => {
      if (block.id !== 'opt-a') expect(next.plan.blocks[i]).toBe(block);
    });
    expect((findBlock(prev, 'opt-a') as OptionBlock).steps).toEqual({ state: 'none' });
    expect(pendingMessages(next).map((m) => m.id)).toEqual(['m-1']);
  });

  it('choose on a non-option block throws NOT_AN_OPTION', () => {
    const state = openPlan(loadPlan(), NOW);

    expect(thrownCode(() => postMessage(state, choose('verdict', 'client-01'), NOW))).toBe('NOT_AN_OPTION');
    expect(thrownCode(() => postMessage(state, choose('nope', 'client-02'), NOW))).toBe('NOT_FOUND');
  });

  it('choose when steps are ready throws STEPS_EXIST', () => {
    const state = withSteps(openPlan(loadPlan(), NOW), 'opt-a', { state: 'ready', blockId: 'steps-opt-a' });

    expect(thrownCode(() => postMessage(state, choose('opt-a', 'client-01'), NOW))).toBe('STEPS_EXIST');
    expect(state.messages).toEqual([]);
  });

  it('choose when steps are already requested is accepted again', () => {
    const first = postMessage(openPlan(loadPlan(), NOW), choose('opt-a', 'client-01'), NOW);
    const again = postMessage(first.state, choose('opt-a', 'client-02'), NOW);

    expect((findBlock(again.state, 'opt-a') as OptionBlock).steps).toEqual({ state: 'requested' });
    expect(again.state.messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);
  });
});

function done(clientId: string): BrowserMessage {
  return { clientId, kind: 'done', text: '' };
}

describe('postMessage done', () => {
  it('done sets review to handed-back and touches no block', () => {
    const prev = openPlan(loadPlan(), NOW);
    const later = '2026-10-03T10:05:00.000Z';
    const result = postMessage(prev, done('client-01'), later);

    expect(result.touched).toEqual([]);
    expect(result.duplicate).toBe(false);
    expect(result.message).toEqual({ id: 'm-1', clientId: 'client-01', kind: 'done', text: '', at: later });
    expect(result.state.review).toBe('handed-back');
    expect(result.state.messages).toEqual([result.message]);
    expect(result.state.revision).toBe(2);
    expect(result.state.nextMessageSeq).toBe(2);
    expect(result.state.plan.blocks).toBe(prev.plan.blocks);
    expect(prev.review).toBe('open');
    expect(pendingMessages(result.state).map((m) => m.id)).toEqual(['m-1']);
  });

  it('ask after hand-back throws HANDED_BACK', () => {
    const handedBack = postMessage(openPlan(loadPlan(), NOW), done('client-01'), NOW).state;

    expect(thrownCode(() => postMessage(handedBack, ask('opt-a', 'why?', 'client-02'), NOW))).toBe('HANDED_BACK');
    expect(thrownCode(() => postMessage(handedBack, choose('opt-a', 'client-03'), NOW))).toBe('HANDED_BACK');
    expect(handedBack.messages.map((m) => m.id)).toEqual(['m-1']);
  });

  it('a retried ask posted before hand-back still returns its stored message', () => {
    const asked = postMessage(openPlan(loadPlan(), NOW), ask('opt-a', 'why?', 'client-01'), NOW);
    const handedBack = postMessage(asked.state, done('client-02'), NOW).state;
    const retry = postMessage(handedBack, ask('opt-a', 'why?', 'client-01'), NOW);

    expect(retry.duplicate).toBe(true);
    expect(retry.message).toBe(asked.message);
    expect(retry.state).toBe(handedBack);
  });

  it('a second done with a new clientId is stored and changes nothing else', () => {
    const first = postMessage(openPlan(loadPlan(), NOW), done('client-01'), NOW).state;
    const second = postMessage(first, done('client-02'), NOW);

    expect(second.duplicate).toBe(false);
    expect(second.touched).toEqual([]);
    expect(second.state.messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(second.state.review).toBe('handed-back');
    expect(second.state.revision).toBe(3);
    expect(second.state.plan.blocks).toBe(first.plan.blocks);
  });
});

describe('markDelivered', () => {
  function threeMessages(): PlanState {
    let state = openPlan(loadPlan(), NOW);
    state = postMessage(state, ask('opt-b', 'Why a timer?', 'client-01'), NOW).state;
    state = postMessage(state, ask('opt-b', 'And the cost?', 'client-02'), NOW).state;
    return postMessage(state, choose('opt-a', 'client-03'), NOW).state;
  }

  it('markDelivered stamps deliveredAt and flips the ask exchange to delivered', () => {
    const prev = threeMessages();
    const later = '2026-10-03T10:05:00.000Z';
    const result = markDelivered(prev, ['m-1', 'm-2', 'm-3', 'm-99'], later);
    const next = result.state;

    expect(result.touched).toEqual(['opt-b']);
    expect(next.messages.map((m) => m.deliveredAt)).toEqual([later, later, later]);
    expect(findBlock(next, 'opt-b')?.qa.map((e) => e.state)).toEqual(['delivered', 'delivered']);
    expect(findBlock(next, 'opt-b')?.rev).toBe(4);
    expect(findBlock(next, 'opt-b')?.touchedAt).toBe(next.revision);
    expect(next.revision).toBe(prev.revision + 1);
    expect(next.nextMessageSeq).toBe(prev.nextMessageSeq);
    expect(pendingMessages(next).map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3']);

    prev.plan.blocks.forEach((block, i) => {
      if (block.id !== 'opt-b') expect(next.plan.blocks[i]).toBe(block);
    });
    expect(prev.messages.every((m) => m.deliveredAt === undefined)).toBe(true);
    expect(findBlock(prev, 'opt-b')?.qa.map((e) => e.state)).toEqual(['asked', 'asked']);
  });

  it('markDelivered keeps the first deliveredAt on a second delivery and touches nothing then', () => {
    const first = markDelivered(threeMessages(), ['m-1', 'm-3'], '2026-10-03T10:05:00.000Z').state;
    const again = markDelivered(first, ['m-1', 'm-2', 'm-3'], '2026-10-03T10:09:00.000Z');

    expect(again.touched).toEqual(['opt-b']);
    expect(again.state.messages.map((m) => m.deliveredAt)).toEqual([
      '2026-10-03T10:05:00.000Z',
      '2026-10-03T10:09:00.000Z',
      '2026-10-03T10:05:00.000Z',
    ]);

    const third = markDelivered(again.state, ['m-1', 'm-2', 'm-3'], '2026-10-03T10:20:00.000Z');

    expect(third.touched).toEqual([]);
    expect(third.state.messages).toEqual(again.state.messages);
    expect(third.state.plan.blocks).toEqual(again.state.plan.blocks);
    third.state.plan.blocks.forEach((block, i) => {
      expect(block).toBe(again.state.plan.blocks[i] as (typeof third.state.plan.blocks)[number]);
    });
    expect(third.state.revision).toBe(again.state.revision + 1);
  });
});

describe('ackMessages', () => {
  function threeMessages(): PlanState {
    let state = openPlan(loadPlan(), NOW);
    state = postMessage(state, ask('opt-b', 'Why a timer?', 'client-01'), NOW).state;
    state = postMessage(state, ask('opt-b', 'And the cost?', 'client-02'), NOW).state;
    return postMessage(state, choose('opt-a', 'client-03'), NOW).state;
  }

  it('ackMessages removes the ids from pendingMessages', () => {
    const prev = threeMessages();
    const later = '2026-10-03T10:05:00.000Z';
    const result = ackMessages(prev, ['m-1', 'm-3'], later);

    expect(result.touched).toEqual([]);
    expect(result.state.messages.map((m) => m.ackedAt)).toEqual([later, undefined, later]);
    expect(pendingMessages(result.state).map((m) => m.id)).toEqual(['m-2']);
    expect(result.state.revision).toBe(prev.revision + 1);
    expect(result.state.nextMessageSeq).toBe(prev.nextMessageSeq);
    expect(result.state.plan).toBe(prev.plan);
    expect(pendingMessages(prev).map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3']);
  });

  it('ackMessages with an unknown id throws NOT_FOUND and acking twice keeps the first ackedAt', () => {
    const prev = threeMessages();

    expect(thrownCode(() => ackMessages(prev, ['m-1', 'm-99'], NOW))).toBe('NOT_FOUND');
    expect(prev.messages.every((m) => m.ackedAt === undefined)).toBe(true);

    const first = ackMessages(prev, ['m-1'], '2026-10-03T10:05:00.000Z').state;
    const again = ackMessages(first, ['m-1', 'm-2'], '2026-10-03T10:09:00.000Z');

    expect(again.state.messages.map((m) => m.ackedAt)).toEqual([
      '2026-10-03T10:05:00.000Z',
      '2026-10-03T10:09:00.000Z',
      undefined,
    ]);
    expect(again.state.revision).toBe(first.revision + 1);
    expect(pendingMessages(again.state).map((m) => m.id)).toEqual(['m-3']);
  });
});
