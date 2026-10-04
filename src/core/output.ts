import { basename, resolve } from 'node:path';
import type { Presence } from './presence';
import { ANSWER_MAX, type Issue } from './schema';
import { blockLabel, findBlock } from './state';
import type { Exchange, Message, OptionBlock, PlanState, PlanSummary } from './types';

export type Invocation = string;

export const POLL_KEYS = ['status', 'plan_id', 'messages', 'next_step', 'page'] as const;

export type PollStatus = 'messages' | 'done' | 'waiting' | 'browser_closed';

export type ErrorCode =
  | 'BAD_ARGS'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NOT_AN_OPTION'
  | 'STEPS_EXIST'
  | 'ALREADY_ANSWERED'
  | 'BLOCK_FULL'
  | 'THREAD_BUSY'
  | 'HANDED_BACK'
  | 'RECOMMENDED_LOCKED'
  | 'KIND_MISMATCH'
  | 'SERVER_UNREACHABLE'
  | 'POLL_INTERRUPTED'
  | 'INVARIANT_VIOLATION'
  | 'IO';

export interface PollMessage {
  id: string;
  kind: Message['kind'];
  block_id?: string;
  block_label?: string;
  option_id?: string;
  thread_id?: string;
  thread?: (Pick<Exchange, 'question' | 'excerpt'> & { answer: string })[];
  text: string;
  excerpt?: string;
  at: string;
}

export interface PollPage {
  url: string;
  revision: number;
  presence: Presence;
  pollers: number;
  block_ids: string[];
}

export interface PollOutput {
  status: PollStatus;
  plan_id: string;
  messages: PollMessage[];
  next_step: string;
  page: PollPage;
}

const UNANSWERED_TEXT_MAX = 60;
const MAX_LISTED_ISSUES = 3;
const DEFAULT_STATE_DIR = '~/.pinpoint';

export function sanitizeLabel(label: string): string {
  return label.replace(/\s*[\r\n]+\s*/g, ' ').replace(/`/g, '');
}

export function detectInvocation(argv1: string, execPath: string, env: Record<string, string | undefined>): Invocation {
  if (env.PINPOINT_INVOCATION) return env.PINPOINT_INVOCATION;
  if (basename(argv1) === 'pinpoint') return 'pinpoint';
  return `${execPath} ${resolve(argv1)}`;
}

export function pollMessage(m: Message, state: PlanState): PollMessage {
  const block = m.kind === 'ask' && m.blockId !== undefined ? findBlock(state, m.blockId) : undefined;
  const threadId = m.threadId ?? m.id;
  const thread = (block?.qa ?? []).flatMap((e) =>
    e.threadId === threadId && e.id !== m.id && e.answer !== undefined
      ? [{ question: e.question, ...(e.excerpt === undefined ? {} : { excerpt: e.excerpt }), answer: e.answer.md }]
      : [],
  );
  return {
    id: m.id,
    kind: m.kind,
    ...(m.blockId === undefined ? {} : { block_id: m.blockId }),
    ...(block === undefined ? {} : { block_label: sanitizeLabel(blockLabel(block)) }),
    ...(m.optionId === undefined ? {} : { option_id: m.optionId }),
    ...(m.kind === 'ask' ? { thread_id: threadId, thread } : {}),
    text: m.text,
    ...(m.excerpt === undefined ? {} : { excerpt: m.excerpt }),
    at: m.at,
  };
}

export function pollOutput(input: {
  status: PollStatus;
  planId: string;
  messages: PollMessage[];
  nextStep: string;
  page: PollPage;
}): PollOutput {
  return {
    status: input.status,
    plan_id: input.planId,
    messages: input.messages,
    next_step: input.nextStep,
    page: input.page,
  };
}

export function openedOutput(input: {
  status: 'opened' | 'replaced';
  planId: string;
  url: string;
  revision: number;
  blockIds: string[];
  droppedMessages: string[];
  nextStep: string;
}) {
  return {
    status: input.status,
    plan_id: input.planId,
    url: input.url,
    revision: input.revision,
    block_ids: input.blockIds,
    dropped_messages: input.droppedMessages,
    next_step: input.nextStep,
  };
}

export function receiptOutput(input: {
  status: 'patched' | 'answered' | 'steps-appended' | 'acked';
  planId: string;
  touched: string[];
  revision: number;
  acked: string[];
  pending: number;
  nextStep: string;
}) {
  return {
    status: input.status,
    plan_id: input.planId,
    touched: input.touched,
    revision: input.revision,
    untouched_unchanged: true as const,
    acked: input.acked,
    pending: input.pending,
    next_step: input.nextStep,
  };
}

export function errorOutput(input: { code: ErrorCode; message: string; issues?: Issue[]; nextStep: string }) {
  return {
    status: 'error' as const,
    code: input.code,
    message: input.message,
    ...(input.issues === undefined ? {} : { issues: input.issues }),
    next_step: input.nextStep,
  };
}

export function homeOutput(input: {
  app: string;
  version: string;
  helper: { url: string; running: boolean };
  plans: PlanSummary[];
  commands: { name: string; usage: string; summary: string }[];
  nextStep: string;
}) {
  return {
    status: 'home' as const,
    app: input.app,
    version: input.version,
    helper: input.helper,
    next_step: input.nextStep,
    plans: input.plans,
    commands: input.commands.map(({ name, usage, summary }) => ({ name, usage, summary })),
  };
}

export function statusOutput(input: {
  planId: string;
  url: string;
  revision: number;
  presence: Presence;
  pendingMessages: number;
  blockIds: string[];
  nextStep: string;
}) {
  return {
    status: 'status' as const,
    plan_id: input.planId,
    url: input.url,
    revision: input.revision,
    presence: input.presence,
    pending_messages: input.pendingMessages,
    block_ids: input.blockIds,
    next_step: input.nextStep,
  };
}

export function pollTail(inv: Invocation, id: string): string {
  return `Then run \`${inv} poll ${id}\` as a background Bash command (run_in_background: true, timeout: 7200000); Claude Code re-invokes you when it exits. Never use nohup, &, or disown. If it is killed, run it again: messages stay queued until you answer or ack them.`;
}

export function nextStepHome(inv: Invocation): string {
  return `Write a plan as JSON (\`${inv} example plan\` prints the shape), then run \`${inv} open <plan.json>\`.`;
}

export function nextStepOpened(inv: Invocation, id: string, url: string): string {
  return `Do not respond to the user yet. The plan is open at ${url}. ${pollTail(inv, id)}`;
}

export function nextStepWaiting(inv: Invocation, id: string): string {
  return `Nothing arrived within the wait cap; nothing was lost. ${pollTail(inv, id)}`;
}

export function nextStepBrowserClosed(url: string): string {
  return `The browser tab was closed. Do not poll again on your own: tell the user the plan is still at ${url} and ask whether to keep waiting.`;
}

function shortLabel(label: string): string {
  return /^(?:Steps · )?Way [ABC]/.exec(sanitizeLabel(label))?.[0] ?? sanitizeLabel(label);
}

function messageLine(inv: Invocation, id: string, m: PollMessage): string | undefined {
  if (m.kind === 'ask') {
    const where = m.block_label === undefined ? (m.block_id ?? 'plan') : shortLabel(m.block_label);
    const thread = m.thread_id ?? m.id;
    const show = `${inv} show ${id}${m.block_id === undefined ? '' : ` --block ${m.block_id}`}`;
    const route = m.thread?.length
      ? `send it to thread ${thread}'s subagent with SendMessage. If that subagent is gone, start one with \`thread\`.`
      : `start a Sonnet subagent for thread ${thread} (Agent tool, model sonnet). Give it the question, the excerpt and \`${show}\`. It returns the answer markdown (≤${ANSWER_MAX} chars) and optionally a graph.`;
    return `- ${m.id} (${where}): ${route} Then run \`${inv} answer ${id} --question ${m.id} --file <answer.json>\`. If you cannot start subagents, answer it yourself.`;
  }
  if (m.kind === 'choose') {
    const option = m.option_id ?? m.block_id ?? '';
    return `- ${m.id}: write the concrete steps for option ${option} (\`${inv} example steps\` for the shape) and run \`${inv} append-steps ${id} ${option} --file <steps.json>\``;
  }
  return undefined;
}

export function nextStepForMessages(inv: Invocation, id: string, messages: PollMessage[], pollers: number): string {
  const lines = messages.map((m) => messageLine(inv, id, m)).filter((line): line is string => line !== undefined);
  return [
    'Do not respond to the user yet. Handle each message in order, changing nothing but the block named:',
    ...lines,
    ...(pollers > 1 ? ['Another poll is attached to this plan; coordinate before answering.'] : []),
    ...(messages.some((m) => m.kind === 'ask')
      ? ['Start every subagent above in one message and wait for all of them; poll only after every answer is written.']
      : []),
    pollTail(inv, id),
  ].join('\n');
}

function unansweredItem(state: PlanState, m: Message): string {
  const block = m.blockId === undefined ? undefined : findBlock(state, m.blockId);
  const where = block === undefined ? 'plan' : shortLabel(blockLabel(block));
  const flat = sanitizeLabel(m.text);
  const text = flat.length > UNANSWERED_TEXT_MAX ? `${flat.slice(0, UNANSWERED_TEXT_MAX)}…` : flat;
  return `${m.id} (${where}: '${text}')`;
}

export function nextStepDone(_inv: Invocation, _id: string, state: PlanState, unanswered: Message[]): string {
  const chosen = state.plan.blocks
    .filter((block): block is OptionBlock => block.kind === 'option' && block.steps.state !== 'none')
    .map((option) => `Way ${option.letter}`);
  const head = `The user finished reviewing. Stop polling and continue in the conversation. Chosen: ${chosen.length === 0 ? 'none' : chosen.join(', ')}.`;
  if (unanswered.length === 0) return head;
  return `${head} Unanswered questions: ${unanswered.map((m) => unansweredItem(state, m)).join(', ')}.`;
}

export function nextStepReceipt(inv: Invocation, id: string, pending: number): string {
  if (pending > 0)
    return `${pending} message(s) still pending; run \`${inv} poll ${id}\` now (it returns immediately).`;
  return `Do not respond to the user yet. ${pollTail(inv, id)}`;
}

export function nextStepError(
  inv: Invocation,
  code: ErrorCode,
  issues?: Issue[],
  stateDir: string = DEFAULT_STATE_DIR,
): string {
  if (code === 'INVALID_INPUT') {
    const listed = (issues ?? [])
      .slice(0, MAX_LISTED_ISSUES)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    return `Fix these and retry: ${listed}. \`${inv} example plan\` prints a valid shape.`;
  }
  if (code === 'SERVER_UNREACHABLE' || code === 'POLL_INTERRUPTED') {
    return `Run the same command again; nothing was lost. If it keeps failing, read ${stateDir}/helper.log or run \`${inv} serve\` in another terminal.`;
  }
  return `Fix the command and retry; \`${inv} help\` lists every command, its flags and the open plans.`;
}
