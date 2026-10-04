import { afterEach, describe, expect, it } from 'bun:test';
import { EXAMPLES } from '../../src/cli/examples';
import type { CliIo } from '../../src/cli/io';
import { run } from '../../src/cli/run';
import { createSkillMarkdown, validateSkill } from '../../src/cli/skill';
import { POLL_KEYS } from '../../src/core/output';
import { parseAnswerInput, parseBlockInput, parsePlanInput, parseStepsInput } from '../../src/core/schema';
import { asFetch, fakeIo } from '../helpers/fake-io';
import { ask, fixture, makeTestApp, seedPlan, TEST_BASE_URL, type TestApp, waitFor } from '../helpers/test-app';

const INV = '/opt/bun /x/bin/pinpoint.ts';

function cliIo(t: TestApp, over: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io = fakeIo({
    fetch: asFetch((u, i) => Promise.resolve(t.app.request(u, i))),
    env: { PINPOINT_PORT: '4777', HOME: '/home/tester' },
    argv1: '/x/bin/pinpoint.ts',
    execPath: '/opt/bun',
    stdout: (s) => {
      out.push(s);
    },
    stderr: (s) => {
      err.push(s);
    },
    ...over,
  });
  return { io, out, err };
}

function onlyDocument(out: string[]): Record<string, unknown> {
  expect(out).toHaveLength(1);
  const text = out[0] as string;
  expect(text.endsWith('\n')).toBe(true);
  return JSON.parse(text.slice(0, -1));
}

describe('run read-only commands', () => {
  it('status and show print the stored plan and block', async () => {
    const t = makeTestApp();
    await seedPlan(t);

    const status = cliIo(t);
    expect(await run(['status', 'auth-refresh'], status.io)).toBe(0);
    const statusDoc = onlyDocument(status.out);
    expect(statusDoc).toMatchObject({
      status: 'status',
      plan_id: 'auth-refresh',
      url: `${TEST_BASE_URL}/plans/auth-refresh`,
      revision: 1,
      presence: 'waiting',
      pending_messages: 0,
      block_ids: ['findings', 'opt-a', 'opt-b', 'opt-c', 'verdict'],
    });
    expect(statusDoc.next_step).toContain(`${INV} poll auth-refresh`);

    const show = cliIo(t);
    expect(await run(['show', 'auth-refresh'], show.io)).toBe(0);
    const state = onlyDocument(show.out);
    expect(state.plan).toMatchObject({ id: 'auth-refresh', title: 'Refresh expired auth tokens' });
    expect(state.revision).toBe(1);

    const block = cliIo(t);
    expect(await run(['show', 'auth-refresh', '--block', 'opt-b'], block.io)).toBe(0);
    expect(onlyDocument(block.out)).toMatchObject({ kind: 'option', id: 'opt-b', name: 'Proactive refresh timer' });
  });

  it('home and help list the commands and the open plans without spawning the helper', async () => {
    const t = makeTestApp();
    await seedPlan(t);
    for (const argv of [[], ['help']]) {
      const { io, out } = cliIo(t);
      expect(await run(argv, io)).toBe(0);
      const doc = onlyDocument(out);
      expect(doc).toMatchObject({
        status: 'home',
        app: 'pinpoint',
        helper: { url: TEST_BASE_URL, running: true },
      });
      expect((doc.plans as { id: string }[]).map((p) => p.id)).toEqual(['auth-refresh']);
      expect((doc.commands as { name: string }[]).map((c) => c.name)).toContain('poll');
      expect(doc.next_step).toContain(`${INV} example plan`);
    }
  });

  it('home reports a stopped helper with no plans when the helper is unreachable', async () => {
    const t = makeTestApp();
    const { io, out } = cliIo(t, {
      fetch: asFetch(() => {
        throw new TypeError('connection refused');
      }),
    });
    expect(await run([], io)).toBe(0);
    expect(onlyDocument(out)).toMatchObject({ helper: { url: TEST_BASE_URL, running: false }, plans: [] });
  });

  it('example with each kind prints the fixture and no argument prints the plan', async () => {
    const t = makeTestApp();
    for (const kind of ['steps', 'answer', 'block'] as const) {
      const { io, out } = cliIo(t);
      expect(await run(['example', kind], io)).toBe(0);
      expect(onlyDocument(out)).toEqual(EXAMPLES[kind] as unknown as Record<string, unknown>);
    }
    const { io, out } = cliIo(t);
    expect(await run(['example'], io)).toBe(0);
    expect(onlyDocument(out)).toEqual(EXAMPLES.plan as unknown as Record<string, unknown>);
  });
});

describe('run errors', () => {
  it('an unknown command exits 1 with BAD_ARGS and a next_step naming help', async () => {
    const t = makeTestApp();
    const { io, out } = cliIo(t);
    expect(await run(['frobnicate'], io)).toBe(1);
    const doc = onlyDocument(out);
    expect(doc).toMatchObject({ status: 'error', code: 'BAD_ARGS' });
    expect(doc.next_step).toContain(`${INV} help`);
  });

  it('status without an id, an unknown example kind and a missing plan all exit 1', async () => {
    const t = makeTestApp();
    const cases: [string[], string][] = [
      [['status'], 'BAD_ARGS'],
      [['show'], 'BAD_ARGS'],
      [['example', 'nope'], 'BAD_ARGS'],
      [['status', 'no-such-plan'], 'NOT_FOUND'],
      [['show', 'no-such-plan'], 'NOT_FOUND'],
      [['show', 'auth-refresh', '--bogus'], 'BAD_ARGS'],
    ];
    await seedPlan(t);
    for (const [argv, code] of cases) {
      const { io, out } = cliIo(t);
      expect(await run(argv, io)).toBe(1);
      expect(onlyDocument(out)).toMatchObject({ status: 'error', code });
    }
  });

  it('an unreachable helper on status exits 1 with SERVER_UNREACHABLE and a re-run next_step', async () => {
    const t = makeTestApp();
    const { io, out } = cliIo(t, {
      fetch: asFetch(() => {
        throw new TypeError('connection refused');
      }),
    });
    expect(await run(['status', 'auth-refresh'], io)).toBe(1);
    const doc = onlyDocument(out);
    expect(doc.code).toBe('SERVER_UNREACHABLE');
    expect(doc.next_step).toContain('Run the same command again');
    expect(doc.next_step).toContain('/home/tester/.pinpoint/helper.log');
  });
});

describe('examples', () => {
  it('example plan equals the fixture and parses', () => {
    expect(EXAMPLES.plan).toEqual(fixture('plan.auth-refresh') as typeof EXAMPLES.plan);
    expect(EXAMPLES.steps).toEqual(fixture('steps.opt-a') as typeof EXAMPLES.steps);
    expect(EXAMPLES.answer).toEqual(fixture('answer.opt-b') as typeof EXAMPLES.answer);
    expect(EXAMPLES.block).toEqual(fixture('block.opt-b.patched') as typeof EXAMPLES.block);

    expect(parsePlanInput(EXAMPLES.plan).ok).toBe(true);
    expect(parseStepsInput(EXAMPLES.steps).ok).toBe(true);
    expect(parseAnswerInput(EXAMPLES.answer).ok).toBe(true);
    expect(parseBlockInput(EXAMPLES.block).ok).toBe(true);
  });
});

describe('run open', () => {
  const planText = () => JSON.stringify(fixture('plan.auth-refresh'));
  const invalidText = () => JSON.stringify(fixture('invalid/plan.five-options'));

  function openIo(t: TestApp, opened: string[], over: Partial<CliIo> = {}) {
    return cliIo(t, {
      readFile: () => Promise.resolve(planText()),
      openBrowser: (url) => {
        opened.push(url);
      },
      spawnDaemon: () => {
        throw new Error('the helper is already healthy; spawnDaemon must not run');
      },
      ...over,
    });
  }

  it('open prints an opened document with block ids and a next_step naming poll', async () => {
    const t = makeTestApp();
    const opened: string[] = [];
    const first = openIo(t, opened);
    expect(await run(['open', 'plan.json'], first.io)).toBe(0);
    const doc = onlyDocument(first.out);
    expect(doc).toMatchObject({
      status: 'opened',
      plan_id: 'auth-refresh',
      url: `${TEST_BASE_URL}/plans/auth-refresh`,
      revision: 1,
      block_ids: ['findings', 'opt-a', 'opt-b', 'opt-c', 'verdict'],
      dropped_messages: [],
    });
    expect(doc.next_step).toContain(`\`${INV} poll auth-refresh\``);
    expect(opened).toEqual([`${TEST_BASE_URL}/plans/auth-refresh`]);

    const second = openIo(t, opened);
    expect(await run(['open', 'plan.json'], second.io)).toBe(0);
    expect(onlyDocument(second.out)).toMatchObject({ status: 'replaced', dropped_messages: [] });
    expect(opened).toHaveLength(2);
  });

  it('open - reads the plan from stdin', async () => {
    const t = makeTestApp();
    const opened: string[] = [];
    const { io, out } = openIo(t, opened, { readStdin: () => Promise.resolve(planText()) });
    expect(await run(['open', '-'], io)).toBe(0);
    expect(onlyDocument(out)).toMatchObject({ status: 'opened', plan_id: 'auth-refresh' });
  });

  it('open with an invalid plan exits 1 with INVALID_INPUT and the example hint', async () => {
    const t = makeTestApp();
    const opened: string[] = [];
    const puts: string[] = [];
    const { io, out } = openIo(t, opened, {
      readFile: () => Promise.resolve(invalidText()),
      fetch: asFetch((u, i) => {
        puts.push(`${i?.method ?? 'GET'} ${String(u)}`);
        return Promise.resolve(t.app.request(u, i));
      }),
    });
    expect(await run(['open', 'plan.json'], io)).toBe(1);
    const doc = onlyDocument(out);
    expect(doc).toMatchObject({ status: 'error', code: 'INVALID_INPUT' });
    expect((doc.issues as unknown[]).length).toBeGreaterThan(0);
    expect(doc.next_step).toContain('example plan');
    expect(puts).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('open without a source exits 1 with BAD_ARGS', async () => {
    const t = makeTestApp();
    const { io, out } = openIo(t, []);
    expect(await run(['open'], io)).toBe(1);
    expect(onlyDocument(out)).toMatchObject({ status: 'error', code: 'BAD_ARGS' });
  });

  it('open respects --no-open and PINPOINT_NO_OPEN', async () => {
    const t = makeTestApp();
    const opened: string[] = [];
    const flagged = openIo(t, opened);
    expect(await run(['open', 'plan.json', '--no-open'], flagged.io)).toBe(0);
    expect(onlyDocument(flagged.out)).toMatchObject({ status: 'opened' });

    const envd = openIo(t, opened, { env: { PINPOINT_PORT: '4777', HOME: '/home/tester', PINPOINT_NO_OPEN: '1' } });
    expect(await run(['open', 'plan.json'], envd.io)).toBe(0);
    expect(onlyDocument(envd.out)).toMatchObject({ status: 'replaced' });
    expect(opened).toEqual([]);
  });
});

describe('run agent loop commands', () => {
  let t: TestApp;

  afterEach(() => t.close());

  const postAsk = async (blockId: string, text: string): Promise<string> => {
    const res = await t.request('/api/plans/auth-refresh/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ask(blockId, text)),
    });
    return ((await res.json()) as { message: { id: string } }).message.id;
  };

  const files = (contents: Record<string, string>): Partial<CliIo> => ({
    readFile: (path) => {
      const text = contents[path];
      return text === undefined ? Promise.reject(new Error(`no such file ${path}`)) : Promise.resolve(text);
    },
  });

  it('poll wakes through run() when a message is posted through the app', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const { io, out, err } = cliIo(t);

    const exit = run(['poll', 'auth-refresh', '--timeout-ms', '2000'], io);
    await waitFor(() => t.polls.waiters('auth-refresh') === 1);
    const id = await postAsk('opt-b', 'what happens when the laptop sleeps?');

    expect(await exit).toBe(0);
    const doc = onlyDocument(out);
    expect(Object.keys(doc)).toEqual([...POLL_KEYS]);
    expect(doc).toMatchObject({
      status: 'messages',
      plan_id: 'auth-refresh',
      messages: [{ id, kind: 'ask', block_id: 'opt-b', text: 'what happens when the laptop sleeps?' }],
    });
    expect(doc.next_step).toContain(INV);
    expect(err).toEqual([expect.stringContaining('waiting for messages on auth-refresh')]);
  });

  it('poll exits 0 with status waiting when the timeout passes with nothing posted', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const { io, out } = cliIo(t);
    expect(await run(['poll', 'auth-refresh', '--timeout-ms', '0'], io)).toBe(0);
    expect(onlyDocument(out)).toMatchObject({ status: 'waiting', plan_id: 'auth-refresh', messages: [] });
  });

  it('answer, append-steps, patch-block and ack print receipts with the touched ids', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const questionId = await postAsk('opt-b', 'what happens when the laptop sleeps?');
    const ackId = await postAsk('findings', 'where did these findings come from?');
    const answer = fixture('answer.opt-b') as { md: string; diagram: unknown };
    const stepsBody = fixture('steps.opt-a') as { steps: unknown };
    const blockBody = fixture('block.opt-b.patched');

    const answered = cliIo(t, files({ 'graph.json': JSON.stringify(answer.diagram) }));
    expect(
      await run(
        ['answer', 'auth-refresh', '--question', questionId, '--text', answer.md, '--diagram', 'graph.json'],
        answered.io,
      ),
    ).toBe(0);
    const answeredDoc = onlyDocument(answered.out);
    expect(answeredDoc).toMatchObject({
      status: 'answered',
      plan_id: 'auth-refresh',
      touched: ['opt-b'],
      untouched_unchanged: true,
      acked: [questionId],
      pending: 1,
    });
    expect(answeredDoc.next_step).toContain(`${INV} poll auth-refresh`);
    const stored = t.store.get('auth-refresh')?.plan.blocks.find((b) => b.id === 'opt-b');
    expect(stored?.qa[0]?.answer).toMatchObject({ md: answer.md, diagram: answer.diagram });

    const appended = cliIo(t, files({ 'steps.json': JSON.stringify({ steps: stepsBody.steps }) }));
    expect(await run(['append-steps', 'auth-refresh', 'opt-a', '--file', 'steps.json'], appended.io)).toBe(0);
    expect(onlyDocument(appended.out)).toMatchObject({ status: 'steps-appended', touched: ['opt-a', 'steps-opt-a'] });

    const patched = cliIo(t, files({ 'block.json': JSON.stringify(blockBody) }));
    expect(await run(['patch-block', 'auth-refresh', 'opt-b', '--file', 'block.json'], patched.io)).toBe(0);
    expect(onlyDocument(patched.out)).toMatchObject({ status: 'patched', touched: expect.arrayContaining(['opt-b']) });

    const acked = cliIo(t);
    expect(await run(['ack', 'auth-refresh', ackId], acked.io)).toBe(0);
    expect(onlyDocument(acked.out)).toMatchObject({ status: 'acked', acked: [ackId], pending: 0 });
  });

  it('append-steps takes the option id from the positional or rejects a mismatch', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const body = fixture('steps.opt-a');

    const mismatch = cliIo(t, files({ 'steps.json': JSON.stringify(body) }));
    expect(await run(['append-steps', 'auth-refresh', 'opt-b', '--file', 'steps.json'], mismatch.io)).toBe(1);
    expect(onlyDocument(mismatch.out)).toMatchObject({ status: 'error', code: 'BAD_ARGS' });

    const matching = cliIo(t, files({ 'steps.json': JSON.stringify(body) }));
    expect(await run(['append-steps', 'auth-refresh', 'opt-a', '--file', 'steps.json'], matching.io)).toBe(0);
    expect(onlyDocument(matching.out)).toMatchObject({ status: 'steps-appended' });
  });

  it('bad arguments on the loop commands exit 1 with BAD_ARGS or INVALID_INPUT', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const cases: [string[], string][] = [
      [['poll'], 'BAD_ARGS'],
      [['poll', 'auth-refresh', '--timeout-ms', 'soon'], 'BAD_ARGS'],
      [['poll', 'auth-refresh', '--timeout-ms', '-5'], 'BAD_ARGS'],
      [['answer', 'auth-refresh', '--text', 'hello'], 'BAD_ARGS'],
      [['answer', 'auth-refresh', '--question', 'm-1', '--text', ''], 'INVALID_INPUT'],
      [['answer', 'auth-refresh', '--question', 'm-9', '--text', 'hello'], 'NOT_FOUND'],
      [['append-steps', 'auth-refresh'], 'BAD_ARGS'],
      [['patch-block', 'auth-refresh'], 'BAD_ARGS'],
      [['ack', 'auth-refresh'], 'BAD_ARGS'],
      [['ack', 'auth-refresh', 'm-9'], 'NOT_FOUND'],
    ];
    for (const [argv, code] of cases) {
      const { io, out } = cliIo(t);
      expect(await run(argv, io)).toBe(1);
      expect(onlyDocument(out)).toMatchObject({ status: 'error', code });
    }
  });

  it('a rejected fetch during poll prints a POLL_INTERRUPTED error document with a re-run next_step and exits 1', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const { io, out } = cliIo(t, {
      fetch: asFetch((u, i) => {
        if (!String(u).includes('/poll')) return Promise.resolve(t.app.request(u, i));
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(' '));
            controller.error(new Error('socket hang up'));
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }),
    });

    expect(await run(['poll', 'auth-refresh'], io)).toBe(1);
    const doc = onlyDocument(out);
    expect(doc).toMatchObject({ status: 'error', code: 'POLL_INTERRUPTED' });
    expect(doc.next_step).toContain('Run the same command again');
  });

  it('stop shuts the helper down and prints stopped, and an already stopped helper prints stopped too', async () => {
    let shutdowns = 0;
    t = makeTestApp({
      onShutdown: () => {
        shutdowns += 1;
      },
    });
    const running = cliIo(t);
    expect(await run(['stop'], running.io)).toBe(0);
    expect(onlyDocument(running.out)).toEqual({ status: 'stopped' });
    await waitFor(() => shutdowns === 1);

    const gone = cliIo(t, {
      fetch: asFetch(() => {
        throw new TypeError('connection refused');
      }),
    });
    expect(await run(['stop'], gone.io)).toBe(0);
    expect(onlyDocument(gone.out)).toEqual({ status: 'stopped' });
  });

  it('loop commands restart a helper that died before running', async () => {
    t = makeTestApp();
    await seedPlan(t);
    let spawned = 0;
    let up = false;
    const { io, out } = cliIo(t, {
      fetch: asFetch((u, i) => {
        if (!up) throw new TypeError('connection refused');
        return Promise.resolve(t.app.request(u, i));
      }),
      spawnDaemon: () => {
        spawned += 1;
        up = true;
      },
      sleep: () => Promise.resolve(),
    });
    expect(await run(['poll', 'auth-refresh', '--timeout-ms', '0'], io)).toBe(0);
    expect(spawned).toBe(1);
    expect(onlyDocument(out)).toMatchObject({ status: 'waiting' });
  });

  it('stdout of every command parses as exactly one json document', async () => {
    t = makeTestApp();
    await seedPlan(t);
    const questionId = await postAsk('opt-b', 'what happens when the laptop sleeps?');
    const ackId = await postAsk('findings', 'where did these findings come from?');
    const answer = fixture('answer.opt-b');
    const contents = {
      'steps.json': JSON.stringify(fixture('steps.opt-a')),
      'block.json': JSON.stringify(fixture('block.opt-b.patched')),
      'broken.json': '{',
    };

    const argvs: string[][] = [
      ['poll', 'auth-refresh', '--timeout-ms', '0'],
      ['poll', 'no-such-plan', '--timeout-ms', '0'],
      ['answer', 'auth-refresh', '--question', questionId, '--text', String(answer.md)],
      ['answer', 'auth-refresh', '--question', questionId, '--text', 'again'],
      ['append-steps', 'auth-refresh', 'opt-a', '--file', 'steps.json'],
      ['append-steps', 'auth-refresh', 'opt-a', '--file', 'broken.json'],
      ['patch-block', 'auth-refresh', 'opt-b', '--file', 'block.json'],
      ['patch-block', 'auth-refresh', 'no-such-block', '--file', 'block.json'],
      ['ack', 'auth-refresh', ackId],
      ['ack', 'auth-refresh', 'm-99'],
      ['stop'],
    ];
    for (const argv of argvs) {
      const { io, out } = cliIo(t, files(contents));
      const exit = await run(argv, io);
      const text = out.join('');
      expect(text.trim().split('\n')).toHaveLength(1);
      expect(typeof JSON.parse(text)).toBe('object');
      expect(exit).toBe(JSON.parse(text).status === 'error' ? 1 : 0);
    }
  });
});

describe('skill --install', () => {
  function installIo(env: Record<string, string>) {
    const out: string[] = [];
    const written: { path: string; content: string }[] = [];
    const io = fakeIo({
      env: { HOME: '/home/tester', ...env },
      argv1: '/repo/bin/pinpoint.ts',
      execPath: '/opt/bun',
      stdout: (s) => {
        out.push(s);
      },
      writeFile: (path, content) => {
        written.push({ path, content });
        return Promise.resolve();
      },
    });
    return { io, out, written };
  }

  it('skill --install --out writes a file whose allowed-tools carries the absolute invocation', async () => {
    const custom = installIo({});
    expect(await run(['skill', '--install', '--out', '/tmp/x/SKILL.md'], custom.io)).toBe(0);
    const prefix = '/opt/bun /repo/bin/pinpoint.ts';
    expect(custom.written).toHaveLength(1);
    expect(custom.written[0]?.path).toBe('/tmp/x/SKILL.md');
    const md = custom.written[0]?.content as string;
    expect(md).toBe(createSkillMarkdown({ invocation: prefix }));
    expect(md.split('\n')).toContain(`allowed-tools: Bash(${prefix}:*)`);
    expect(md).toContain(`\`${prefix} open <file>\``);
    expect(validateSkill(md)).toEqual([]);
    expect(onlyDocument(custom.out)).toMatchObject({
      status: 'skill-installed',
      path: '/tmp/x/SKILL.md',
      invocation: prefix,
      chars: md.length,
    });
    expect(typeof onlyDocument(custom.out).next_step).toBe('string');

    const home = installIo({});
    expect(await run(['skill', '--install'], home.io)).toBe(0);
    expect(home.written.map((w) => w.path)).toEqual(['/home/tester/.claude/skills/pinpoint/SKILL.md']);
  });

  it('skill --install honours PINPOINT_INVOCATION', async () => {
    const { io, out, written } = installIo({ PINPOINT_INVOCATION: 'pp' });
    expect(await run(['skill', '--install', '--out', '/tmp/x/SKILL.md'], io)).toBe(0);
    const md = written[0]?.content as string;
    expect(md.split('\n')).toContain('allowed-tools: Bash(pp:*)');
    expect(md).toContain('`pp open <file>`');
    expect(onlyDocument(out)).toMatchObject({ status: 'skill-installed', invocation: 'pp' });
  });

  it('skill --out without --install is a bad-args error and writes nothing', async () => {
    const { io, out, written } = installIo({});
    expect(await run(['skill', '--out', '/tmp/x/SKILL.md'], io)).toBe(1);
    expect(onlyDocument(out)).toMatchObject({ status: 'error', code: 'BAD_ARGS' });
    expect(written).toEqual([]);
  });
});
