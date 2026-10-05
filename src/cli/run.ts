import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Invocation } from '../core/output';
import {
  detectInvocation,
  errorOutput,
  homeOutput,
  nextStepError,
  nextStepHome,
  nextStepOpened,
  nextStepReceipt,
  openedOutput,
  statusOutput,
} from '../core/output';
import { parseAnswerInput, parseBlockInput, parsePlanInput, parseStepsInput } from '../core/schema';
import { startServer } from '../server/start';
import { VERSION } from '../version';
import { apiClient } from './api';
import { type ParsedArgs, parseArgs } from './args';
import { readBody, readJsonBody } from './body';
import { COMMANDS } from './commands';
import { ensureServer } from './ensure-server';
import { CliError } from './errors';
import { EXAMPLES, isExampleKind } from './examples';
import { type CliIo, type Config, configFrom } from './io';
import { createSkillMarkdown, SKILL_PATH, validateSkill } from './skill';

interface Context {
  args: ParsedArgs;
  io: CliIo;
  config: Config;
  inv: Invocation;
  api: ReturnType<typeof apiClient>;
}

type Handler = (ctx: Context) => Promise<unknown>;

function requireId({ args }: Context): string {
  const id = args.positionals[0];
  if (id === undefined) {
    throw new CliError('BAD_ARGS', `\`${args.command}\` needs a plan id as its first argument.`);
  }
  return id;
}

const home: Handler = async ({ config, inv, api }) => {
  let running = true;
  let plans: Awaited<ReturnType<typeof api.listPlans>> = [];
  try {
    plans = (await api.health()).plans;
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'SERVER_UNREACHABLE') throw error;
    running = false;
  }
  return homeOutput({
    app: 'pinpoint',
    version: VERSION,
    helper: { url: config.baseUrl, running },
    plans,
    commands: COMMANDS,
    nextStep: nextStepHome(inv),
  });
};

const example: Handler = async ({ args }) => {
  const kind = args.positionals[0] ?? 'plan';
  if (!isExampleKind(kind)) {
    throw new CliError('BAD_ARGS', `Unknown example "${kind}"; use one of ${Object.keys(EXAMPLES).join(', ')}.`);
  }
  return EXAMPLES[kind];
};

const status: Handler = async (ctx) => {
  const id = requireId(ctx);
  const [state, summaries] = await Promise.all([ctx.api.getPlan(id), ctx.api.listPlans()]);
  const summary = summaries.find((s) => s.id === id);
  if (summary === undefined) throw new CliError('NOT_FOUND', `No plan with id ${id}.`);
  return statusOutput({
    planId: id,
    url: summary.url,
    revision: state.revision,
    presence: summary.presence,
    pendingMessages: summary.pending,
    blockIds: state.plan.blocks.map((block) => block.id),
    nextStep: nextStepReceipt(summary.pending),
  });
};

const show: Handler = async (ctx) => {
  const id = requireId(ctx);
  const blockId = ctx.args.flags.block;
  if (typeof blockId === 'string') return ctx.api.getBlock(id, blockId);
  return ctx.api.getPlan(id);
};

const open: Handler = async ({ args, io, config, inv, api }) => {
  const source = args.positionals[0];
  if (source === undefined) {
    throw new CliError('BAD_ARGS', '`open` needs a plan file path, or - to read the plan from stdin.');
  }
  const input = await readJsonBody(io, { file: source }, parsePlanInput);
  await ensureServer(io, config);
  const opened = await api.openPlan(input.id, input);
  if (args.flags['no-open'] !== true && !config.noOpen) await io.openBrowser(opened.url);
  return openedOutput({
    status: opened.replaced ? 'replaced' : 'opened',
    planId: opened.plan_id,
    url: opened.url,
    revision: opened.revision,
    blockIds: opened.block_ids,
    droppedMessages: opened.dropped_messages,
    nextStep: nextStepOpened(inv, opened.plan_id, opened.url),
  });
};

function requireArg(ctx: Context, index: number, what: string): string {
  const value = ctx.args.positionals[index];
  if (value === undefined) {
    throw new CliError('BAD_ARGS', `\`${ctx.args.command}\` needs ${what}.`);
  }
  return value;
}

function parseTimeoutMs(flag: string | true | undefined): number | undefined {
  if (flag === undefined) return undefined;
  if (typeof flag !== 'string' || !/^\d+$/.test(flag) || !Number.isSafeInteger(Number(flag))) {
    throw new CliError('BAD_ARGS', '--timeout-ms must be a whole number of milliseconds, 0 or more.');
  }
  return Number(flag);
}

const poll: Handler = async (ctx) => {
  const id = requireId(ctx);
  const timeoutMs = parseTimeoutMs(ctx.args.flags['timeout-ms']);
  await ensureServer(ctx.io, ctx.config);
  ctx.io.stderr(`pinpoint: waiting for messages on ${id} (Ctrl-C is safe; messages stay queued)\n`);
  return ctx.api.poll(id, timeoutMs);
};

/** Long-polls until the plan is handed back or its tab closes, printing one JSON line per batch of new messages. */
const watch: Handler = async (ctx) => {
  const id = requireId(ctx);
  await ensureServer(ctx.io, ctx.config);
  ctx.io.stderr(`pinpoint: watching ${id}, one line per batch of messages (Ctrl-C is safe; messages stay queued)\n`);
  const seen = new Set<string>();
  for (;;) {
    const out = await ctx.api.poll(id, undefined, seen);
    if (out.status === 'done' || out.status === 'browser_closed') return out;
    if (out.status !== 'messages') continue;
    for (const message of out.messages) seen.add(message.id);
    ctx.io.stdout(`${JSON.stringify(out)}\n`);
  }
};

const answer: Handler = async (ctx) => {
  const id = requireId(ctx);
  const questionId = ctx.args.flags.question;
  if (typeof questionId !== 'string') {
    throw new CliError('BAD_ARGS', '`answer` needs --question <message-id>, the id of the question being answered.');
  }
  const md = await readBody(ctx.io, ctx.args.flags);
  const diagramPath = ctx.args.flags.diagram;
  if (diagramPath === true) throw new CliError('BAD_ARGS', '--diagram needs a path to a graph JSON file.');
  const diagram =
    diagramPath === undefined
      ? undefined
      : await readJsonBody(ctx.io, { file: diagramPath }, (raw) => ({ ok: true, value: raw }));
  const parsed = parseAnswerInput({ questionId, md, ...(diagram === undefined ? {} : { diagram }) });
  if (!parsed.ok) throw new CliError('INVALID_INPUT', 'the answer does not match the expected shape', parsed.issues);
  await ensureServer(ctx.io, ctx.config);
  return ctx.api.answer(id, parsed.value);
};

const appendSteps: Handler = async (ctx) => {
  const id = requireId(ctx);
  const optionId = requireArg(ctx, 1, 'an option id after the plan id');
  const input = await readJsonBody(ctx.io, ctx.args.flags, (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return parseStepsInput(raw);
    const bodyOptionId = (raw as { optionId?: unknown }).optionId;
    if (bodyOptionId !== undefined && bodyOptionId !== optionId) {
      throw new CliError(
        'BAD_ARGS',
        `the body targets option ${String(bodyOptionId)} but the command names ${optionId}.`,
      );
    }
    return parseStepsInput({ ...raw, optionId });
  });
  await ensureServer(ctx.io, ctx.config);
  return ctx.api.appendSteps(id, input);
};

const patchBlock: Handler = async (ctx) => {
  const id = requireId(ctx);
  const blockId = requireArg(ctx, 1, 'a block id after the plan id');
  const input = await readJsonBody(ctx.io, ctx.args.flags, parseBlockInput);
  await ensureServer(ctx.io, ctx.config);
  return ctx.api.patchBlock(id, blockId, input);
};

const ack: Handler = async (ctx) => {
  const id = requireId(ctx);
  const ids = ctx.args.positionals.slice(1);
  if (ids.length === 0) throw new CliError('BAD_ARGS', '`ack` needs one or more message ids after the plan id.');
  await ensureServer(ctx.io, ctx.config);
  return ctx.api.ack(id, ids);
};

const stop: Handler = async ({ api }) => {
  try {
    await api.shutdown();
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'SERVER_UNREACHABLE') throw error;
  }
  return { status: 'stopped' };
};

function intFlag(flag: string | true | undefined, name: string, min: number, max: number): number | undefined {
  if (flag === undefined) return undefined;
  const value = typeof flag === 'string' && /^\d+$/.test(flag) ? Number(flag) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CliError('BAD_ARGS', `--${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

const signalCleanups = new Set<() => Promise<void>>();

/** Runs the cleanups registered by long-lived commands; resolves true when at least one ran. */
export async function runSignalCleanups(): Promise<boolean> {
  const cleanups = [...signalCleanups];
  await Promise.all(cleanups.map((cleanup) => cleanup()));
  return cleanups.length > 0;
}

const serve: Handler = async ({ args, io, config }) => {
  const stateFlag = args.flags['state-dir'];
  const port = intFlag(args.flags.port, 'port', 1, 65535) ?? config.port;
  const stateDir = typeof stateFlag === 'string' ? stateFlag : config.stateDir;
  const idleTimeoutMs = intFlag(args.flags['idle-ms'], 'idle-ms', 0, Number.MAX_SAFE_INTEGER) ?? config.idleTimeoutMs;
  const log = (message: string) => io.stderr(`${io.now().toISOString()} pinpoint helper ${message}\n`);
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      port,
      stateDir,
      idleTimeoutMs,
      pollMaxWaitMs: config.pollMaxWaitMs,
      browserGraceMs: config.browserGraceMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`error: ${message}`);
    throw new CliError('IO', message);
  }
  const stopped = server.closed.then(() => log('stopped'));
  const cleanup = async () => {
    await server.close();
    await stopped;
  };
  signalCleanups.add(cleanup);
  log(`listening on ${server.url} (state ${stateDir})`);
  io.stdout(`${JSON.stringify({ status: 'serving', url: server.url, port: server.port, state_dir: stateDir })}\n`);
  await stopped;
  signalCleanups.delete(cleanup);
  return undefined;
};

const SKILL_INVOCATION = 'pinpoint';

const installSkill: Handler = async ({ args, io, inv }) => {
  const md = createSkillMarkdown({ invocation: inv });
  const issues = validateSkill(md);
  if (issues.length > 0) {
    return errorOutput({
      code: 'INVALID_INPUT',
      message: 'the generated skill does not validate',
      issues,
      nextStep: 'Fix the skill template in src/cli/skill.ts and run `skill --install` again.',
    });
  }
  const out = args.flags.out;
  const path =
    typeof out === 'string' ? out : join(io.env.HOME ?? homedir(), '.claude', 'skills', 'pinpoint', 'SKILL.md');
  await io.writeFile(path, md);
  return {
    status: 'skill-installed',
    path,
    invocation: inv,
    chars: md.length,
    next_step: 'The pinpoint skill is installed; use it the next time the user asks for a plan.',
  };
};

const skill: Handler = async (ctx) => {
  const { args, io, inv } = ctx;
  if (args.flags.install === true) return installSkill(ctx);
  if (args.flags.out !== undefined) {
    throw new CliError('BAD_ARGS', '`skill --out` only applies together with --install.');
  }
  const md = createSkillMarkdown({ invocation: SKILL_INVOCATION });
  if (args.flags.check !== true) {
    await io.writeFile(SKILL_PATH, md);
    return {
      status: 'skill-written',
      path: SKILL_PATH,
      chars: md.length,
      next_step: 'Commit skills/pinpoint/SKILL.md if it changed.',
    };
  }
  const committed = await io.readFile(SKILL_PATH).catch(() => undefined);
  if (committed === md) {
    return { status: 'skill-ok', path: SKILL_PATH, next_step: 'The committed skill is up to date.' };
  }
  return errorOutput({
    code: 'INVALID_INPUT',
    message: 'skills/pinpoint/SKILL.md is out of date',
    nextStep: `Run \`${inv} skill\` to regenerate it, then commit the file.`,
  });
};

const HANDLERS: Record<string, Handler> = {
  serve,
  home,
  help: home,
  example,
  status,
  show,
  open,
  poll,
  watch,
  answer,
  'append-steps': appendSteps,
  'patch-block': patchBlock,
  ack,
  stop,
  skill,
};

export async function run(argv: string[], io: CliIo): Promise<number> {
  const inv = detectInvocation(io.argv1, io.execPath, io.env);
  let stateDir: string | undefined;
  try {
    const config = configFrom(io.env);
    stateDir = config.stateDir;
    const args = parseArgs(argv);
    const handler = HANDLERS[args.command];
    if (handler === undefined) {
      throw new CliError('BAD_ARGS', `Unknown command "${args.command}".`);
    }
    const api = apiClient(io.fetch, config.baseUrl, inv);
    const doc = await handler({ args, io, config, inv, api });
    if (doc !== undefined) io.stdout(`${JSON.stringify(doc)}\n`);
    return (doc as { status?: unknown } | undefined)?.status === 'error' ? 1 : 0;
  } catch (error) {
    const failure =
      error instanceof CliError ? error : new CliError('IO', error instanceof Error ? error.message : String(error));
    io.stdout(
      `${JSON.stringify(
        errorOutput({
          code: failure.code,
          message: failure.message,
          issues: failure.issues,
          nextStep: nextStepError(inv, failure.code, failure.issues, stateDir),
        }),
      )}\n`,
    );
    return 1;
  }
}
