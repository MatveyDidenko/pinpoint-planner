import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AnswerInput,
  type BlockInput,
  type BrowserMessage,
  type Finding,
  MAX_EXCHANGES,
  type OptionInput,
  type PlanInput,
  parseAnswerInput,
  parseBlockInput,
  parsePlanInput,
  parseStepsInput,
  type StepsInput,
} from '../../src/core/schema';
import {
  ackMessages,
  appendSteps,
  attachAnswer,
  blockLabel,
  findBlock,
  markDelivered,
  openPlan,
  patchBlock,
  pendingMessages,
  postMessage,
  replacePlan,
} from '../../src/core/state';
import {
  type FindingsBlock,
  type OptionBlock,
  type PlanState,
  StateError,
  type StepsBlock,
  type VerdictBlock,
} from '../../src/core/types';

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
      threadId: 'm-1',
    });
    expect(next.messages).toEqual([result.message]);
    expect(next.nextMessageSeq).toBe(2);
    expect(next.revision).toBe(2);

    const target = findBlock(next, 'opt-b');
    expect(target?.qa).toEqual([
      {
        id: 'm-1',
        threadId: 'm-1',
        question: 'Why a timer?',
        excerpt: 'Background renewal',
        askedAt: later,
        state: 'asked',
      },
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

  it('a new ask starts its own thread', () => {
    const result = postMessage(openPlan(loadPlan(), NOW), ask('opt-b', 'Why a timer?', 'client-01'), NOW);

    expect(result.message.threadId).toBe('m-1');
    expect(findBlock(result.state, 'opt-b')?.qa.map((e) => e.threadId)).toEqual(['m-1']);
  });

  it('two fresh asks on one block start two threads', () => {
    let state = openPlan(loadPlan(), NOW);
    state = postMessage(state, ask('opt-b', 'Why a timer?', 'client-01'), NOW).state;
    state = postMessage(state, ask('opt-b', 'Why not the wrapper?', 'client-02'), NOW).state;

    expect(findBlock(state, 'opt-b')?.qa.map((e) => [e.id, e.threadId])).toEqual([
      ['m-1', 'm-1'],
      ['m-2', 'm-2'],
    ]);
    expect(state.messages.map((m) => m.threadId)).toEqual(['m-1', 'm-2']);
  });

  it('an ask naming a thread joins it', () => {
    let state = postMessage(openPlan(loadPlan(), NOW), ask('opt-b', 'Why a timer?', 'client-01'), NOW).state;
    state = attachAnswer(state, { questionId: 'm-1', md: 'It renews before expiry.' }, NOW).state;
    const result = postMessage(state, { ...ask('opt-b', 'Even when asleep?', 'client-02'), threadId: 'm-1' }, NOW);

    expect(result.message).toMatchObject({ id: 'm-2', threadId: 'm-1' });
    expect(findBlock(result.state, 'opt-b')?.qa.map((e) => [e.id, e.threadId])).toEqual([
      ['m-1', 'm-1'],
      ['m-2', 'm-1'],
    ]);
  });

  it('an ask naming a thread on another block throws NOT_FOUND', () => {
    const state = postMessage(openPlan(loadPlan(), NOW), ask('opt-b', 'Why a timer?', 'client-01'), NOW).state;
    const misplaced = { ...ask('opt-a', 'Same here?', 'client-02'), threadId: 'm-1' };

    expect(() => postMessage(state, misplaced, NOW)).toThrow('no thread m-1 on block opt-a');
    expect(thrownCode(() => postMessage(state, misplaced, NOW))).toBe('NOT_FOUND');
  });

  it('a reply after the answer lands is accepted', () => {
    let state = postMessage(openPlan(loadPlan(), NOW), ask('opt-b', 'Why a timer?', 'client-01'), NOW).state;
    state = markDelivered(state, ['m-1'], NOW).state;
    const reply = { ...ask('opt-b', 'Even when asleep?', 'client-02'), threadId: 'm-1' };
    expect(thrownCode(() => postMessage(state, reply, NOW))).toBe('THREAD_BUSY');

    state = attachAnswer(state, { questionId: 'm-1', md: 'It renews before expiry.' }, NOW).state;
    const accepted = postMessage(state, reply, NOW);

    expect(accepted.message.threadId).toBe('m-1');
    expect(findBlock(accepted.state, 'opt-b')?.qa.map((e) => e.state)).toEqual(['answered', 'asked']);
    const second = { ...ask('opt-b', 'And then?', 'client-03'), threadId: 'm-1' };
    expect(thrownCode(() => postMessage(accepted.state, second, NOW))).toBe('THREAD_BUSY');
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

  it('the forty-first ask on one block throws BLOCK_FULL', () => {
    expect(MAX_EXCHANGES).toBe(40);
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

describe('attachAnswer', () => {
  function loadAnswer(): AnswerInput {
    const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'answer.opt-b.json'), 'utf8'));
    const parsed = parseAnswerInput(raw);
    if (!parsed.ok) throw new Error('fixture answer is invalid');
    return parsed.value;
  }

  function askedOnOptB(): PlanState {
    let state = openPlan(loadPlan(), NOW);
    state = postMessage(state, ask('opt-b', 'Why a timer?', 'client-01'), NOW).state;
    return postMessage(state, ask('opt-a', 'Why a wrapper?', 'client-02'), NOW).state;
  }

  it('attachAnswer answers the exchange, acks its message and touches only that block', () => {
    const prev = askedOnOptB();
    const later = '2026-10-03T10:05:00.000Z';
    const answer = loadAnswer();
    const result = attachAnswer(prev, answer, later);
    const exchange = (findBlock(result.state, 'opt-b') as OptionBlock).qa[0];

    expect(result.touched).toEqual(['opt-b']);
    expect(exchange?.state).toBe('answered');
    expect(exchange?.answer).toEqual({ md: answer.md, diagram: answer.diagram, at: later });
    expect(result.state.messages.map((m) => m.ackedAt)).toEqual([later, undefined]);
    expect(result.state.revision).toBe(prev.revision + 1);
    expect(findBlock(result.state, 'opt-b')?.rev).toBe((findBlock(prev, 'opt-b')?.rev as number) + 1);
    expect(findBlock(result.state, 'opt-b')?.touchedAt).toBe(result.state.revision);
    expect(findBlock(result.state, 'opt-a')).toBe(findBlock(prev, 'opt-a') as OptionBlock);
    expect(findBlock(result.state, 'verdict')).toBe(findBlock(prev, 'verdict') as VerdictBlock);
    expect(findBlock(prev, 'opt-b')?.qa[0]?.state).toBe('asked');
  });

  it('attachAnswer without a diagram leaves the diagram key off the answer', () => {
    const result = attachAnswer(askedOnOptB(), { questionId: 'm-1', md: 'Plain text.' }, NOW);
    const answered = (findBlock(result.state, 'opt-b') as OptionBlock).qa[0]?.answer;

    expect(answered).toEqual({ md: 'Plain text.', at: NOW });
    expect(answered && 'diagram' in answered).toBe(false);
  });

  it('attachAnswer twice throws ALREADY_ANSWERED', () => {
    const answered = attachAnswer(askedOnOptB(), loadAnswer(), NOW).state;

    expect(thrownCode(() => attachAnswer(answered, loadAnswer(), NOW))).toBe('ALREADY_ANSWERED');
  });

  it('attachAnswer for an unknown question throws NOT_FOUND', () => {
    expect(thrownCode(() => attachAnswer(askedOnOptB(), { questionId: 'm-99', md: 'x' }, NOW))).toBe('NOT_FOUND');
  });
});

describe('appendSteps', () => {
  function loadSteps(name: string): StepsInput {
    const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', name), 'utf8'));
    const parsed = parseStepsInput(raw);
    if (!parsed.ok) throw new Error(`fixture ${name} is invalid`);
    return parsed.value;
  }

  function chosenA(): PlanState {
    return postMessage(openPlan(loadPlan(), NOW), choose('opt-a', 'client-01'), NOW).state;
  }

  it('appendSteps adds steps-<opt> last, marks the option ready and acks its chooses', () => {
    const prev = chosenA();
    const later = '2026-10-03T10:05:00.000Z';
    const input = loadSteps('steps.opt-a.json');
    const result = appendSteps(prev, input, later);
    const blocks = result.state.plan.blocks;
    const steps = blocks[blocks.length - 1] as StepsBlock;
    const option = findBlock(result.state, 'opt-a') as OptionBlock;

    expect(blocks.map((b) => b.id)).toEqual(['findings', 'opt-a', 'opt-b', 'opt-c', 'verdict', 'steps-opt-a']);
    expect(steps).toEqual({
      id: 'steps-opt-a',
      kind: 'steps',
      label: 'Steps · Way A · Refresh inside the fetch wrapper',
      optionId: 'opt-a',
      letter: 'A',
      optionName: 'Refresh inside the fetch wrapper',
      steps: input.steps,
      rev: 1,
      touchedAt: result.state.revision,
      qa: [],
    });
    expect(option.steps).toEqual({ state: 'ready', blockId: 'steps-opt-a' });
    expect(option.rev).toBe((findBlock(prev, 'opt-a')?.rev as number) + 1);
    expect(option.touchedAt).toBe(result.state.revision);
    expect(result.touched).toEqual(['opt-a', 'steps-opt-a']);
    expect(result.appended).toEqual({ blockId: 'steps-opt-a', after: 'verdict' });
    expect(result.state.revision).toBe(prev.revision + 1);
    expect(result.state.messages.map((m) => m.ackedAt)).toEqual([later]);
    expect(pendingMessages(result.state)).toEqual([]);
    expect(findBlock(result.state, 'opt-b')).toBe(findBlock(prev, 'opt-b') as OptionBlock);
    expect(findBlock(result.state, 'verdict')).toBe(findBlock(prev, 'verdict') as VerdictBlock);
  });

  it('appendSteps works for an option nobody chose', () => {
    const result = appendSteps(openPlan(loadPlan(), NOW), loadSteps('steps.opt-c.json'), NOW);

    expect((findBlock(result.state, 'opt-c') as OptionBlock).steps).toEqual({ state: 'ready', blockId: 'steps-opt-c' });
    expect(result.touched).toEqual(['opt-c', 'steps-opt-c']);
  });

  it('appendSteps twice for one option throws STEPS_EXIST', () => {
    const once = appendSteps(chosenA(), loadSteps('steps.opt-a.json'), NOW).state;

    expect(thrownCode(() => appendSteps(once, loadSteps('steps.opt-a.json'), NOW))).toBe('STEPS_EXIST');
  });

  it('appendSteps leaves a pending choose for another option pending', () => {
    const both = postMessage(chosenA(), choose('opt-c', 'client-02'), NOW).state;
    const result = appendSteps(both, loadSteps('steps.opt-a.json'), NOW);

    expect(pendingMessages(result.state).map((m) => [m.id, m.optionId])).toEqual([['m-2', 'opt-c']]);
    expect((findBlock(result.state, 'opt-c') as OptionBlock).steps).toEqual({ state: 'requested' });
  });

  it('appendSteps for an unknown or non-option block throws NOT_FOUND or NOT_AN_OPTION', () => {
    const state = openPlan(loadPlan(), NOW);
    const steps = loadSteps('steps.opt-a.json').steps;

    expect(thrownCode(() => appendSteps(state, { optionId: 'opt-z', steps }, NOW))).toBe('NOT_FOUND');
    expect(thrownCode(() => appendSteps(state, { optionId: 'verdict', steps }, NOW))).toBe('NOT_AN_OPTION');
  });
});

describe('patchBlock', () => {
  type OptionPatch = Extract<BlockInput, { kind: 'option' }>;

  function loadPatch(): OptionPatch {
    const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'block.opt-b.patched.json'), 'utf8'));
    const parsed = parseBlockInput(raw);
    if (!parsed.ok || parsed.value.kind !== 'option') throw new Error('fixture block patch is invalid');
    return parsed.value;
  }

  function recommendedPatch(change: { name?: string; why?: string }): OptionPatch {
    const { options } = loadPlan();
    return { ...(options[0] as OptionInput), ...change, kind: 'option' };
  }

  function askedOnOptB(): PlanState {
    return postMessage(openPlan(loadPlan(), NOW), ask('opt-b', 'Why a timer?', 'client-01'), NOW).state;
  }

  it('patchBlock replaces content, keeps qa and bumps rev', () => {
    const prev = askedOnOptB();
    const input = loadPatch();
    const result = patchBlock(prev, 'opt-b', input, NOW);
    const before = findBlock(prev, 'opt-b') as OptionBlock;
    const after = findBlock(result.state, 'opt-b') as OptionBlock;

    expect(after.diagram).toEqual(input.diagram);
    expect(after.diagram).not.toEqual(before.diagram);
    expect(after.qa).toEqual(before.qa);
    expect(after.qa).toHaveLength(1);
    expect(after.letter).toBe('B');
    expect(after.steps).toEqual(before.steps);
    expect(after.label).toBe('Way B · Proactive refresh timer');
    expect(after.rev).toBe(before.rev + 1);
    expect(after.touchedAt).toBe(result.state.revision);
    expect(result.touched).toEqual(['opt-b']);
    expect(result.state.revision).toBe(prev.revision + 1);
    expect(findBlock(result.state, 'opt-a')).toBe(findBlock(prev, 'opt-a') as OptionBlock);
    expect(findBlock(result.state, 'verdict')).toBe(findBlock(prev, 'verdict') as VerdictBlock);
    expect(findBlock(prev, 'opt-b')).toBe(before);
  });

  it("patching the recommended option's why re-derives the verdict", () => {
    const prev = postMessage(openPlan(loadPlan(), NOW), ask('verdict', 'Why this one?', 'client-01'), NOW).state;
    const result = patchBlock(
      prev,
      'opt-a',
      recommendedPatch({ name: 'Refresh in the wrapper', why: 'One choke point.' }),
      NOW,
    );
    const verdict = findBlock(result.state, 'verdict') as VerdictBlock;
    const before = findBlock(prev, 'verdict') as VerdictBlock;

    expect(result.touched).toEqual(['opt-a', 'verdict']);
    expect(verdict.why).toBe('One choke point.');
    expect(verdict.optionName).toBe('Refresh in the wrapper');
    expect(verdict.label).toBe('The pick');
    expect(verdict.optionId).toBe('opt-a');
    expect(verdict.letter).toBe('A');
    expect(verdict.qa).toEqual(before.qa);
    expect(verdict.rev).toBe(before.rev + 1);
    expect(verdict.touchedAt).toBe(result.state.revision);
    expect((findBlock(result.state, 'opt-a') as OptionBlock).label).toBe('Way A · Refresh in the wrapper');
    expect(result.state.revision).toBe(prev.revision + 1);
  });

  it('patching the recommended option without changing name or why leaves the verdict untouched', () => {
    const prev = openPlan(loadPlan(), NOW);
    const result = patchBlock(prev, 'opt-a', { ...recommendedPatch({}), reuses: ['src/api/retry.ts'] }, NOW);

    expect(result.touched).toEqual(['opt-a']);
    expect(findBlock(result.state, 'verdict')).toBe(findBlock(prev, 'verdict') as VerdictBlock);
  });

  it('patchBlock on findings and verdict replaces their content', () => {
    const prev = openPlan(loadPlan(), NOW);
    const oneItem = loadPlan().findings.items[0] as Finding;
    const findings = patchBlock(prev, 'findings', { kind: 'findings', summary: 'New summary.', items: [oneItem] }, NOW);
    const verdict = patchBlock(prev, 'verdict', { kind: 'verdict', why: 'A better reason.' }, NOW);
    const patchedFindings = findBlock(findings.state, 'findings') as FindingsBlock;

    expect(patchedFindings.summary).toBe('New summary.');
    expect(patchedFindings.items).toEqual([oneItem]);
    expect('diagram' in patchedFindings).toBe(false);
    expect(patchedFindings.rev).toBe(2);
    expect(findings.touched).toEqual(['findings']);
    expect((findBlock(verdict.state, 'verdict') as VerdictBlock).why).toBe('A better reason.');
    expect((findBlock(verdict.state, 'verdict') as VerdictBlock).rev).toBe(2);
    expect(verdict.touched).toEqual(['verdict']);
  });

  it('patchBlock keeps the block id when the input names another option', () => {
    const input = loadPatch();
    const result = patchBlock(openPlan(loadPlan(), NOW), 'opt-c', { ...input, id: 'opt-b' }, NOW);

    expect((findBlock(result.state, 'opt-c') as OptionBlock).letter).toBe('C');
    expect(result.state.plan.blocks.map((b) => b.id)).toEqual(['findings', 'opt-a', 'opt-b', 'opt-c', 'verdict']);
  });

  it('patchBlock that flips recommended throws RECOMMENDED_LOCKED', () => {
    const state = openPlan(loadPlan(), NOW);
    const { options } = loadPlan();
    const demote: OptionPatch = { ...(options[0] as OptionInput), kind: 'option', recommended: false, why: undefined };
    const promote: OptionPatch = { ...loadPatch(), recommended: true, why: 'Because.' };

    expect(thrownCode(() => patchBlock(state, 'opt-a', demote, NOW))).toBe('RECOMMENDED_LOCKED');
    expect(thrownCode(() => patchBlock(state, 'opt-b', promote, NOW))).toBe('RECOMMENDED_LOCKED');
  });

  it('patchBlock with a different kind throws KIND_MISMATCH', () => {
    const withSteps = appendSteps(
      openPlan(loadPlan(), NOW),
      { optionId: 'opt-a', steps: [{ title: 'Do it', touches: [], test: 'It is done.' }] },
      NOW,
    ).state;
    const findings: BlockInput = { kind: 'findings', summary: 'x', items: [loadPlan().findings.items[0] as Finding] };

    expect(thrownCode(() => patchBlock(withSteps, 'opt-a', findings, NOW))).toBe('KIND_MISMATCH');
    expect(thrownCode(() => patchBlock(withSteps, 'verdict', loadPatch(), NOW))).toBe('KIND_MISMATCH');
    expect(thrownCode(() => patchBlock(withSteps, 'steps-opt-a', loadPatch(), NOW))).toBe('KIND_MISMATCH');
  });

  it('patchBlock for an unknown block throws NOT_FOUND', () => {
    expect(thrownCode(() => patchBlock(openPlan(loadPlan(), NOW), 'opt-z', loadPatch(), NOW))).toBe('NOT_FOUND');
  });
});

describe('replacePlan', () => {
  const LATER = '2026-10-03T11:00:00.000Z';
  const stepsOptA: StepsInput = { optionId: 'opt-a', steps: [{ title: 'Do it', touches: [], test: 'It is done.' }] };

  function withExchanges(): PlanState {
    let state = openPlan(loadPlan(), NOW);
    state = postMessage(state, ask('findings', 'what is this?', 'client-01'), NOW).state;
    state = postMessage(state, ask('opt-b', 'why a timer?', 'client-02'), NOW).state;
    state = postMessage(state, ask('verdict', 'sure?', 'client-03'), NOW).state;
    return appendSteps(state, stepsOptA, NOW).state;
  }

  function renamedOptC(): PlanInput {
    const input = loadPlan();
    const [a, b, c] = input.options;
    return { ...input, options: [a, b, { ...c, id: 'opt-d' }] } as PlanInput;
  }

  it('replacePlan keeps exchanges for matching block ids and drops steps blocks', () => {
    const prev = withExchanges();
    const input = { ...loadPlan(), title: 'Auth refresh, second pass', task: 'A new task.' };
    const result = replacePlan(prev, input, LATER);
    const next = result.state;

    expect(next.plan.blocks.map((b) => b.id)).toEqual(['findings', 'opt-a', 'opt-b', 'opt-c', 'verdict']);
    expect(next.plan.title).toBe('Auth refresh, second pass');
    expect(next.plan.task).toBe('A new task.');
    expect(next.plan.openedAt).toBe(prev.plan.openedAt);
    expect(findBlock(next, 'findings')?.qa.map((e) => e.question)).toEqual(['what is this?']);
    expect(findBlock(next, 'opt-b')?.qa.map((e) => e.question)).toEqual(['why a timer?']);
    expect(findBlock(next, 'verdict')?.qa.map((e) => e.question)).toEqual(['sure?']);
    expect(findBlock(next, 'opt-a')?.qa).toEqual([]);
    expect(next.plan.blocks.filter((b) => b.kind === 'option').map((b) => (b as OptionBlock).steps)).toEqual([
      { state: 'none' },
      { state: 'none' },
      { state: 'none' },
    ]);
    expect(next.revision).toBe(prev.revision + 1);
    expect(next.nextMessageSeq).toBe(prev.nextMessageSeq);
    expect(next.review).toBe(prev.review);
    expect(result.touched).toEqual(['findings', 'opt-a', 'opt-b', 'opt-c', 'verdict']);
    for (const block of next.plan.blocks) {
      expect(block.rev).toBe((findBlock(prev, block.id)?.rev as number) + 1);
      expect(block.touchedAt).toBe(next.revision);
    }
    expect(result.dropped).toEqual([]);
  });

  it('replacePlan gives a brand-new block id rev 1 and an empty qa', () => {
    const result = replacePlan(withExchanges(), renamedOptC(), LATER);
    const added = findBlock(result.state, 'opt-d') as OptionBlock;

    expect(added.rev).toBe(1);
    expect(added.qa).toEqual([]);
    expect(added.touchedAt).toBe(result.state.revision);
    expect(result.touched).toEqual(['findings', 'opt-a', 'opt-b', 'opt-d', 'verdict']);
  });

  it('replacePlan acks and reports pending messages on blocks that disappeared', () => {
    let state = withExchanges();
    state = postMessage(state, ask('steps-opt-a', 'why this step?', 'client-04'), NOW).state;
    state = postMessage(state, ask('opt-c', 'and call sites?', 'client-05'), NOW).state;
    state = postMessage(state, choose('opt-b', 'client-06'), NOW).state;
    state = postMessage(state, ask('opt-b', 'still pending?', 'client-07'), NOW).state;
    state = postMessage(state, ask('opt-c', 'answered one', 'client-08'), NOW).state;
    state = attachAnswer(state, { questionId: 'm-8', md: 'ok' }, NOW).state;
    const answeredAckedAt = state.messages.find((m) => m.id === 'm-8')?.ackedAt;

    const result = replacePlan(state, renamedOptC(), LATER);

    expect(result.dropped).toEqual(['m-4', 'm-5']);
    expect(result.state.messages.find((m) => m.id === 'm-4')?.ackedAt).toBe(LATER);
    expect(result.state.messages.find((m) => m.id === 'm-5')?.ackedAt).toBe(LATER);
    expect(result.state.messages.find((m) => m.id === 'm-8')?.ackedAt).toBe(answeredAckedAt);
    expect(pendingMessages(result.state).map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-6', 'm-7']);
    expect((findBlock(result.state, 'opt-b') as OptionBlock).steps).toEqual({ state: 'none' });
  });
});
