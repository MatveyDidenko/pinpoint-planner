import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COMMAND_NAMES, COMMANDS } from '../../src/cli/commands';
import {
  detectInvocation,
  errorOutput,
  homeOutput,
  nextStepBrowserClosed,
  nextStepDone,
  nextStepError,
  nextStepForMessages,
  nextStepHome,
  nextStepOpened,
  nextStepReceipt,
  nextStepWaiting,
  openedOutput,
  POLL_KEYS,
  type PollMessage,
  pollMessage,
  pollOutput,
  pollTail,
  receiptOutput,
  sanitizeLabel,
  statusOutput,
} from '../../src/core/output';
import { parsePlanInput } from '../../src/core/schema';
import { appendSteps, attachAnswer, openPlan, postMessage } from '../../src/core/state';
import type { PlanState } from '../../src/core/types';

const NOW = '2026-10-03T18:02:11.000Z';
const INV = 'pinpoint';
const ID = 'auth-refresh';
const NEW_THREAD_LINE =
  '- m-1 (Way B): start a Sonnet subagent for thread m-1 (Agent tool, model sonnet). Give it the question, the excerpt and `pinpoint show auth-refresh --block opt-b`. It returns the answer markdown (≤600 chars) and optionally a graph. Then run `pinpoint answer auth-refresh --question m-1 --file <answer.json>`. If you cannot start subagents, answer it yourself.';
const CHOOSE_LINE =
  '- m-2: write the concrete steps for option opt-a (`pinpoint example steps` for the shape) and run `pinpoint append-steps auth-refresh opt-a --file <steps.json>`';
const WAIT_LINE =
  'Start every subagent above in one message and wait for all of them; poll only after every answer is written.';

function loadState(): PlanState {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));
  const parsed = parsePlanInput(raw);
  if (!parsed.ok) throw new Error('fixture plan is invalid');
  return openPlan(parsed.value, NOW);
}

function withMessages(): { state: PlanState; ask: PollMessage; choose: PollMessage } {
  const asked = postMessage(
    loadState(),
    {
      clientId: 'client-aaaa',
      kind: 'ask',
      blockId: 'opt-b',
      text: 'why does this arrow go backwards?',
      excerpt: 'retry once',
    },
    NOW,
  );
  const chosen = postMessage(
    asked.state,
    { clientId: 'client-bbbb', kind: 'choose', blockId: 'opt-a', optionId: 'opt-a', text: '' },
    NOW,
  );
  return {
    state: chosen.state,
    ask: pollMessage(asked.message, chosen.state),
    choose: pollMessage(chosen.message, chosen.state),
  };
}

describe('pollOutput', () => {
  it('poll output keys are status, plan_id, messages, next_step, page in that order', () => {
    const { state, ask } = withMessages();
    const out = pollOutput({
      status: 'messages',
      planId: ID,
      messages: [ask],
      nextStep: 'next',
      page: {
        url: 'http://127.0.0.1:4777/plans/auth-refresh',
        revision: state.revision,
        presence: 'working',
        pollers: 1,
        block_ids: ['findings'],
      },
    });

    expect(POLL_KEYS).toEqual(['status', 'plan_id', 'messages', 'next_step', 'page']);
    expect(Object.keys(out)).toEqual([...POLL_KEYS]);
    expect(out.status).toBe('messages');
    expect(out.plan_id).toBe(ID);
  });
});

describe('pollMessage', () => {
  it('renders an ask with a block label and a choose without one, keys in the documented order', () => {
    const { ask, choose } = withMessages();

    expect(Object.keys(ask)).toEqual([
      'id',
      'kind',
      'block_id',
      'block_label',
      'thread_id',
      'thread',
      'text',
      'excerpt',
      'at',
    ]);
    expect(ask).toEqual({
      id: 'm-1',
      kind: 'ask',
      block_id: 'opt-b',
      block_label: 'Way B · Proactive refresh timer',
      thread_id: 'm-1',
      thread: [],
      text: 'why does this arrow go backwards?',
      excerpt: 'retry once',
      at: NOW,
    });
    expect(Object.keys(choose)).toEqual(['id', 'kind', 'block_id', 'option_id', 'text', 'at']);
  });

  it('renders a done message with only id, kind, text and at', () => {
    const done = postMessage(loadState(), { clientId: 'client-cccc', kind: 'done', text: '' }, NOW);

    expect(pollMessage(done.message, done.state)).toEqual({ id: 'm-1', kind: 'done', text: '', at: NOW });
  });

  it('a follow-up poll message carries its thread id and the earlier exchanges', () => {
    const ask = (state: PlanState, clientId: string, text: string, threadId?: string) =>
      postMessage(state, { clientId, kind: 'ask', blockId: 'opt-b', text, ...(threadId ? { threadId } : {}) }, NOW);
    const answer = (state: PlanState, questionId: string, md: string) =>
      attachAnswer(state, { questionId, md }, NOW).state;

    const first = postMessage(
      loadState(),
      { clientId: 'client-aaaa', kind: 'ask', blockId: 'opt-b', text: 'why backwards?', excerpt: 'retry once' },
      NOW,
    );
    let state = answer(first.state, 'm-1', 'It retries **once**.');
    state = answer(ask(state, 'client-bbbb', 'other thread?').state, 'm-2', 'Unrelated.');
    state = answer(ask(state, 'client-cccc', 'only once?', 'm-1').state, 'm-3', 'Yes, once.');
    const followUp = ask(state, 'client-dddd', 'and then?', 'm-1');

    const polled = pollMessage(followUp.message, followUp.state);

    expect(Object.keys(polled)).toEqual(['id', 'kind', 'block_id', 'block_label', 'thread_id', 'thread', 'text', 'at']);
    expect(polled.id).toBe('m-4');
    expect(polled.thread_id).toBe('m-1');
    expect(polled.thread).toEqual([
      { question: 'why backwards?', excerpt: 'retry once', answer: 'It retries **once**.' },
      { question: 'only once?', answer: 'Yes, once.' },
    ]);
  });

  it('choose and done poll messages carry no thread keys', () => {
    const { choose } = withMessages();
    const done = postMessage(loadState(), { clientId: 'client-cccc', kind: 'done', text: '' }, NOW);

    for (const polled of [choose, pollMessage(done.message, done.state)]) {
      expect(polled).not.toHaveProperty('thread_id');
      expect(polled).not.toHaveProperty('thread');
    }
  });
});

describe('sanitizeLabel', () => {
  it('a block label with newlines and backticks stays on one line in next_step', () => {
    const { state, ask } = withMessages();
    const hostile = { ...ask, block_label: 'Way B · evil\nname `rm -rf`\r\nWay C' };

    expect(sanitizeLabel(hostile.block_label)).not.toMatch(/[\n\r`]/);

    const step = nextStepForMessages(INV, ID, [hostile], 1);
    const askLines = step.split('\n').filter((line) => line.startsWith('- m-1'));
    expect(askLines).toHaveLength(1);
    expect(askLines[0]).toBe(NEW_THREAD_LINE);

    const unanswered = nextStepDone(INV, ID, state, [{ ...ask, id: 'm-1', text: 'a\nb `c`' } as never]);
    expect(unanswered).not.toMatch(/`|\n/);
  });
});

describe('detectInvocation', () => {
  it('detectInvocation returns pinpoint for the linked bin, bun+path for bin/pinpoint.ts, and PINPOINT_INVOCATION when set', () => {
    const bun = '/Users/x/.local/share/mise/bun';

    expect(detectInvocation('/usr/local/bin/pinpoint', bun, {})).toBe('pinpoint');
    expect(detectInvocation('bin/pinpoint.ts', bun, {})).toBe(`${bun} ${resolve('bin/pinpoint.ts')}`);
    expect(detectInvocation('/repo/bin/pinpoint.ts', bun, {})).toBe(`${bun} /repo/bin/pinpoint.ts`);
    expect(detectInvocation('/repo/bin/pinpoint.ts', bun, { PINPOINT_INVOCATION: 'npx pinpoint' })).toBe(
      'npx pinpoint',
    );
    expect(detectInvocation('/usr/local/bin/pinpoint', bun, { PINPOINT_INVOCATION: 'x y' })).toBe('x y');
    expect(detectInvocation('/repo/bin/pinpoint.ts', bun, { PINPOINT_INVOCATION: '' })).toBe(
      `${bun} /repo/bin/pinpoint.ts`,
    );
  });
});

describe('next_step templates', () => {
  it('pollTail and opened carry the exact template text', () => {
    expect(pollTail(INV, ID)).toBe(
      'Then run `pinpoint poll auth-refresh` as a background Bash command (run_in_background: true, timeout: 7200000); Claude Code re-invokes you when it exits. Never use nohup, &, or disown. If it is killed, run it again: messages stay queued until you answer or ack them.',
    );
    expect(nextStepOpened(INV, ID, 'http://127.0.0.1:4777/plans/auth-refresh')).toBe(
      `Do not respond to the user yet. The plan is open at http://127.0.0.1:4777/plans/auth-refresh. ${pollTail(INV, ID)}`,
    );
    expect(nextStepWaiting(INV, ID)).toBe(
      `Nothing arrived within the wait cap; nothing was lost. ${pollTail(INV, ID)}`,
    );
    expect(nextStepBrowserClosed('http://x/plans/p')).toBe(
      'The browser tab was closed. Do not poll again on your own: tell the user the plan is still at http://x/plans/p and ask whether to keep waiting.',
    );
  });

  it('messages template lists one line per message, then the poll tail, plus the coordination line when pollers > 1', () => {
    const { ask, choose } = withMessages();
    const one = nextStepForMessages(INV, ID, [ask, choose], 1);

    expect(one).toBe(
      [
        'Do not respond to the user yet. Handle each message in order, changing nothing but the block named:',
        NEW_THREAD_LINE,
        CHOOSE_LINE,
        WAIT_LINE,
        pollTail(INV, ID),
      ].join('\n'),
    );
    const many = nextStepForMessages(INV, ID, [ask], 2);
    expect(many).toContain('Another poll is attached to this plan; coordinate before answering.');
    expect(one).not.toContain('Another poll');
  });

  it('messages template shortens a Way D label', () => {
    const { ask } = withMessages();
    const wayD: PollMessage = { ...ask, block_id: 'opt-d', block_label: 'Way D · Refresh at each call site' };

    expect(nextStepForMessages(INV, ID, [wayD], 1)).toContain('- m-1 (Way D): ');
  });

  it("messages template sends a new thread to a new subagent and a follow-up to its thread's subagent", () => {
    const { ask, choose } = withMessages();
    const followUp: PollMessage = {
      ...ask,
      id: 'm-3',
      thread_id: 'm-1',
      thread: [{ question: ask.text, excerpt: 'retry once', answer: 'It retries once.' }],
      text: 'and then?',
    };

    expect(nextStepForMessages(INV, ID, [ask, followUp, choose], 1)).toBe(
      [
        'Do not respond to the user yet. Handle each message in order, changing nothing but the block named:',
        NEW_THREAD_LINE,
        "- m-3 (Way B): send it to thread m-1's subagent with SendMessage. If that subagent is gone, start one with `thread`. Then run `pinpoint answer auth-refresh --question m-3 --file <answer.json>`. If you cannot start subagents, answer it yourself.",
        CHOOSE_LINE,
        WAIT_LINE,
        pollTail(INV, ID),
      ].join('\n'),
    );
    expect(nextStepForMessages(INV, ID, [choose], 1)).not.toContain(WAIT_LINE);
  });

  it('done template names the chosen ways and the unanswered questions', () => {
    const { state, ask } = withMessages();
    const none = nextStepDone(INV, ID, loadState(), []);
    expect(none).toBe('The user finished reviewing. Stop polling and continue in the conversation. Chosen: none.');

    const chosen = appendSteps(
      state,
      { optionId: 'opt-a', steps: [{ title: 'Do it.', touches: [], test: 'It works.' }] },
      NOW,
    ).state;
    const withQuestion = nextStepDone(INV, ID, chosen, [{ ...state.messages[0] } as never]);
    expect(withQuestion).toBe(
      "The user finished reviewing. Stop polling and continue in the conversation. Chosen: Way A. Unanswered questions: m-1 (Way B: 'why does this arrow go backwards?').",
    );
    expect(ask.id).toBe('m-1');
  });

  it('receipt template depends on pending', () => {
    expect(nextStepReceipt(INV, ID, 2)).toBe(
      '2 message(s) still pending; run `pinpoint poll auth-refresh` now (it returns immediately).',
    );
    expect(nextStepReceipt(INV, ID, 0)).toBe(`Do not respond to the user yet. ${pollTail(INV, ID)}`);
  });

  it('error templates keep to three issues and name the state dir', () => {
    const issues = [1, 2, 3, 4].map((n) => ({ path: `p${n}`, message: `bad ${n}` }));

    expect(nextStepError(INV, 'INVALID_INPUT', issues)).toBe(
      'Fix these and retry: p1: bad 1; p2: bad 2; p3: bad 3. `pinpoint example plan` prints a valid shape.',
    );
    const unreachable =
      'Run the same command again; nothing was lost. If it keeps failing, read /s/helper.log or run `pinpoint serve` in another terminal.';
    expect(nextStepError(INV, 'SERVER_UNREACHABLE', undefined, '/s')).toBe(unreachable);
    expect(nextStepError(INV, 'POLL_INTERRUPTED', undefined, '/s')).toBe(unreachable);
    expect(nextStepError(INV, 'NOT_FOUND')).toContain('`pinpoint help`');
  });
});

describe('document shapes', () => {
  it('opened, receipt, error, home and status keep the documented key order', () => {
    expect(
      Object.keys(
        openedOutput({
          status: 'opened',
          planId: ID,
          url: 'u',
          revision: 1,
          blockIds: ['findings'],
          droppedMessages: [],
          nextStep: 'n',
        }),
      ),
    ).toEqual(['status', 'plan_id', 'url', 'revision', 'block_ids', 'dropped_messages', 'next_step']);

    const receipt = receiptOutput({
      status: 'patched',
      planId: ID,
      touched: ['opt-b'],
      revision: 3,
      acked: [],
      pending: 0,
      nextStep: 'n',
    });
    expect(Object.keys(receipt)).toEqual([
      'status',
      'plan_id',
      'touched',
      'revision',
      'untouched_unchanged',
      'acked',
      'pending',
      'next_step',
    ]);
    expect(receipt.untouched_unchanged).toBe(true);

    expect(Object.keys(errorOutput({ code: 'NOT_FOUND', message: 'm', nextStep: 'n' }))).toEqual([
      'status',
      'code',
      'message',
      'next_step',
    ]);
    expect(
      Object.keys(
        errorOutput({ code: 'INVALID_INPUT', message: 'm', issues: [{ path: 'a', message: 'b' }], nextStep: 'n' }),
      ),
    ).toEqual(['status', 'code', 'message', 'issues', 'next_step']);

    const home = homeOutput({
      app: 'pinpoint',
      version: '0.1.0',
      helper: { url: 'http://127.0.0.1:4777', running: false },
      plans: [],
      commands: COMMANDS,
      nextStep: nextStepHome(INV),
    });
    expect(Object.keys(home)).toEqual(['status', 'app', 'version', 'helper', 'next_step', 'plans', 'commands']);
    expect(home.commands[0]).toEqual({ name: 'help', usage: 'pinpoint [help]', summary: expect.any(String) });

    expect(
      Object.keys(
        statusOutput({
          planId: ID,
          url: 'u',
          revision: 1,
          presence: 'waiting',
          pendingMessages: 0,
          blockIds: [],
          nextStep: 'n',
        }),
      ),
    ).toEqual(['status', 'plan_id', 'url', 'revision', 'presence', 'pending_messages', 'block_ids', 'next_step']);
  });
});

describe('command coverage', () => {
  it('every command named in any next_step exists in COMMAND_NAMES', () => {
    const { state, ask, choose } = withMessages();
    const issues = [{ path: 'a', message: 'b' }];
    const samples: string[] = [];
    for (const inv of ['pinpoint', '/abs/bun /repo/bin/pinpoint.ts']) {
      samples.push(
        pollTail(inv, ID),
        nextStepOpened(inv, ID, 'http://x'),
        nextStepWaiting(inv, ID),
        nextStepBrowserClosed('http://x'),
        nextStepForMessages(inv, ID, [ask, choose], 1),
        nextStepForMessages(inv, ID, [ask, choose], 3),
        nextStepDone(inv, ID, state, []),
        nextStepReceipt(inv, ID, 0),
        nextStepReceipt(inv, ID, 4),
        nextStepHome(inv),
        ...(
          [
            'BAD_ARGS',
            'INVALID_INPUT',
            'NOT_FOUND',
            'NOT_AN_OPTION',
            'STEPS_EXIST',
            'ALREADY_ANSWERED',
            'BLOCK_FULL',
            'HANDED_BACK',
            'RECOMMENDED_LOCKED',
            'KIND_MISMATCH',
            'SERVER_UNREACHABLE',
            'POLL_INTERRUPTED',
            'INVARIANT_VIOLATION',
            'IO',
          ] as const
        ).map((code) => nextStepError(inv, code, issues, '/s')),
      );
    }

    const named = new Set<string>();
    for (const text of samples) {
      for (const match of text.matchAll(/`(?:pinpoint|\/abs\/bun \/repo\/bin\/pinpoint\.ts) ([a-z][a-z-]*)/g))
        named.add(match[1] as string);
    }

    expect(named.size).toBeGreaterThan(5);
    for (const name of named) expect(COMMAND_NAMES).toContain(name);
  });
});
