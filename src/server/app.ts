import type { Context } from 'hono';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { untouchedHash } from '../core/hash';
import {
  type ErrorCode,
  type Invocation,
  nextStepBrowserClosed,
  nextStepDone,
  nextStepForMessages,
  nextStepReceipt,
  nextStepWaiting,
  type PollOutput,
  pollMessage,
  pollOutput,
  receiptOutput,
} from '../core/output';
import { computePresence, type Presence } from '../core/presence';
import { patchAcronyms } from '../core/quality';
import { renderBlock } from '../core/render/blocks';
import { type Assets, renderHome, renderPage } from '../core/render/page';
import {
  type Issue,
  PNG_DATA_URL_PREFIX,
  parseAnswerInput,
  parseBlockInput,
  parseBrowserMessage,
  parsePlanInput,
  parseStepsInput,
  type Result,
} from '../core/schema';
import {
  ackMessages,
  appendSteps,
  attachAnswer,
  findBlock,
  markDelivered,
  patchBlock,
  pendingMessages,
  postMessage,
} from '../core/state';
import { type Block, type PlanState, StateError, type Transition } from '../core/types';
import type { SseFrame } from '../shared/frames';
import { FONT_FILES } from './assets';
import { hostGuard, limitBody, MAX_BODY_BYTES, originGuard } from './guard';
import { PersistenceError } from './persistence';
import { PollHub } from './poll-hub';
import { SseHub } from './sse-hub';
import type { PlanStore } from './store';
import { KeyedTimer } from './timers';

export interface AppDeps {
  store: PlanStore;
  assets: Assets;
  baseUrl: string;
  version: string;
  startedAt: string;
  stateDir?: string | null;
  clock?: () => Date;
  heartbeatMs?: number;
  pollMaxWaitMs?: number;
  browserGraceMs?: number;
  render?: typeof renderBlock;
  onShutdown?: () => void;
  onActivity?: () => void;
}

export interface PinpointApp {
  app: Hono;
  polls: PollHub;
  sse: SseHub;
  browserGrace: KeyedTimer;
  store: PlanStore;
  presence(planId: string): Presence;
  busy(): boolean;
  close(): void;
}

const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_POLL_MAX_WAIT_MS = 1500000;
const DEFAULT_BROWSER_GRACE_MS = 90000;
const DEFAULT_INVOCATION: Invocation = 'pinpoint';
const FONT_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HTML_BLOCK_SUFFIX = '.html';
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const PNG_SUFFIX = '.png';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const STATUS_BY_CODE: Partial<Record<ErrorCode, ContentfulStatusCode>> = {
  INVALID_INPUT: 400,
  NOT_AN_OPTION: 400,
  KIND_MISMATCH: 400,
  RECOMMENDED_LOCKED: 400,
  NOT_FOUND: 404,
  STEPS_EXIST: 409,
  ALREADY_ANSWERED: 409,
  BLOCK_FULL: 409,
  THREAD_BUSY: 409,
  HANDED_BACK: 409,
  INVARIANT_VIOLATION: 500,
  IO: 500,
};

export function httpStatusFor(code: ErrorCode): ContentfulStatusCode {
  return STATUS_BY_CODE[code] ?? 500;
}

export class InvalidInputError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super('The request body is not valid.');
    this.name = 'InvalidInputError';
    this.issues = issues;
  }
}

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new InvalidInputError([{ path: '', message: 'body is not valid JSON' }]);
  }
}

function decodeSketch(dataUrl: string): Uint8Array<ArrayBuffer> {
  const png = Buffer.from(dataUrl.slice(PNG_DATA_URL_PREFIX.length), 'base64');
  if (!PNG_SIGNATURE.every((byte, i) => png[i] === byte)) {
    throw new InvalidInputError([{ path: 'sketch', message: 'sketch is not a PNG image' }]);
  }
  return png;
}

function acknowledgedBy(prev: PlanState, next: PlanState): string[] {
  const alreadyAcked = new Set(prev.messages.filter((m) => m.ackedAt !== undefined).map((m) => m.id));
  return next.messages.filter((m) => m.ackedAt !== undefined && !alreadyAcked.has(m.id)).map((m) => m.id);
}

function parseAckIds(raw: unknown): Result<string[]> {
  const ids = typeof raw === 'object' && raw !== null ? (raw as { ids?: unknown }).ids : undefined;
  if (Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string')) {
    return { ok: true, value: ids };
  }
  return { ok: false, issues: [{ path: 'ids', message: 'must be a non-empty array of message ids' }] };
}

function clampTimeout(raw: string | undefined, maxMs: number): number {
  const requested = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isNaN(requested) ? maxMs : Math.min(Math.max(requested, 0), maxMs);
}

function parseSince(raw: string | undefined): number {
  const since = Number(raw);
  return Number.isInteger(since) && since > 0 ? since : 0;
}

function waitingQuestions(state: PlanState): number {
  return pendingMessages(state).filter((m) => m.kind === 'ask' && m.deliveredAt === undefined).length;
}

function replayFrames(state: PlanState, since: number, render: typeof renderBlock): SseFrame[] {
  const { blocks } = state.plan;
  return blocks.flatMap((block, index): SseFrame[] => {
    if (block.touchedAt <= since) return [];
    const common = { blockId: block.id, rev: block.rev, html: render(block, state.plan.id), revision: state.revision };
    if (block.kind === 'steps' && block.rev === 1) {
      return [{ event: 'appended', data: { ...common, after: blocks[index - 1]?.id ?? null } }];
    }
    return [{ event: 'block', data: common }];
  });
}

function requirePlan(store: PlanStore, id: string): PlanState {
  const state = store.get(id);
  if (state === undefined) throw new StateError('NOT_FOUND', `no plan ${id}`);
  return state;
}

export function createApp(deps: AppDeps): PinpointApp {
  const { store, assets, baseUrl } = deps;
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const pollMaxWaitMs = deps.pollMaxWaitMs ?? DEFAULT_POLL_MAX_WAIT_MS;
  const render = deps.render ?? renderBlock;
  const browserGrace = new KeyedTimer(deps.browserGraceMs ?? DEFAULT_BROWSER_GRACE_MS);
  const reconcileGrace = (planId: string): void => {
    if (sse.clients(planId) > 0 || polls.waiters(planId) === 0) {
      browserGrace.cancel(planId);
      return;
    }
    if (!browserGrace.armed(planId)) browserGrace.arm(planId, () => polls.wake(planId, 'browser_closed'));
  };
  const polls = new PollHub({
    heartbeatMs,
    onChange: (planId) => {
      reconcileGrace(planId);
      sse.broadcast(planId, presenceFrame(planId));
      deps.onActivity?.();
    },
  });
  const sse = new SseHub({
    heartbeatMs,
    onChange: (planId) => {
      reconcileGrace(planId);
      deps.onActivity?.();
    },
  });
  const app = new Hono();

  const presence = (planId: string): Presence => {
    const state = store.get(planId);
    return computePresence({
      review: state?.review ?? 'open',
      messages: state?.messages ?? [],
      pollers: polls.waiters(planId),
    });
  };
  const presenceFrame = (planId: string): SseFrame => {
    const state = store.get(planId);
    return {
      event: 'presence',
      data: { presence: presence(planId), undelivered: state === undefined ? 0 : waitingQuestions(state) },
    };
  };
  const planUrl = (id: string) => `${baseUrl}/plans/${id}`;

  const publish = (planId: string, transition: Transition): void => {
    const { state, touched, appended } = transition;
    for (const blockId of touched) {
      const block = findBlock(state, blockId);
      if (block === undefined || blockId === appended?.blockId) continue;
      sse.broadcast(planId, {
        event: 'block',
        data: { blockId, rev: block.rev, html: render(block, planId), revision: state.revision },
      });
    }
    const added = appended === undefined ? undefined : findBlock(state, appended.blockId);
    if (appended !== undefined && added !== undefined) {
      sse.broadcast(planId, {
        event: 'appended',
        data: {
          blockId: appended.blockId,
          after: appended.after,
          rev: added.rev,
          html: render(added, planId),
          revision: state.revision,
        },
      });
    }
    sse.broadcast(planId, presenceFrame(planId));
  };

  const applyChecked = <T extends Transition>(id: string, fn: (s: PlanState, now: string) => T): T =>
    store.apply(id, fn, (prev, { state, touched }) => {
      const renderIn = (block: Block) => render(block, id);
      if (untouchedHash(prev.plan, touched, renderIn) !== untouchedHash(state.plan, touched, renderIn)) {
        throw new InvariantError('An untouched block changed; the update was not saved.');
      }
    });

  const receipt = (
    c: Context,
    id: string,
    status: Parameters<typeof receiptOutput>[0]['status'],
    prev: PlanState,
    transition: Transition,
  ) => {
    const { state, touched } = transition;
    const pending = pendingMessages(state).length;
    return c.json(
      receiptOutput({
        status,
        planId: id,
        touched,
        revision: state.revision,
        acked: acknowledgedBy(prev, state),
        pending,
        nextStep: nextStepReceipt(c.req.query('inv') || DEFAULT_INVOCATION, id, pending),
      }),
    );
  };

  const pollPage = (state: PlanState, pollers: number): PollOutput['page'] => ({
    url: planUrl(state.plan.id),
    revision: state.revision,
    presence: presence(state.plan.id),
    pollers,
    block_ids: state.plan.blocks.map((block) => block.id),
  });

  const waitingOutput = (id: string, inv: Invocation, pollers: number): PollOutput =>
    pollOutput({
      status: 'waiting',
      planId: id,
      messages: [],
      nextStep: nextStepWaiting(inv, id),
      page: pollPage(requirePlan(store, id), pollers),
    });

  const browserClosedOutput = (id: string, pollers: number): PollOutput =>
    pollOutput({
      status: 'browser_closed',
      planId: id,
      messages: [],
      nextStep: nextStepBrowserClosed(planUrl(id)),
      page: pollPage(requirePlan(store, id), pollers),
    });

  const deliverPending = (id: string, inv: Invocation, pollers: number): PollOutput | null => {
    const pending = pendingMessages(requirePlan(store, id));
    if (pending.length === 0) return null;
    const ids = pending.map((m) => m.id);
    const hasDone = pending.some((m) => m.kind === 'done');
    const transition = store.apply(id, (s, now) => {
      const delivered = markDelivered(s, ids, now);
      if (!hasDone) return delivered;
      return { state: ackMessages(delivered.state, ids, now).state, touched: delivered.touched };
    });
    publish(id, transition);
    const { state } = transition;
    const messages = pending.map((m) => pollMessage(m, state, (mid) => store.persistence.sketchPath(id, mid)));
    return pollOutput({
      status: hasDone ? 'done' : 'messages',
      planId: id,
      messages,
      nextStep: hasDone
        ? nextStepDone(
            inv,
            id,
            state,
            pending.filter((m) => m.kind === 'ask'),
          )
        : nextStepForMessages(inv, id, messages, pollers),
      page: pollPage(state, pollers),
    });
  };

  app.use('*', hostGuard());
  app.use('/api/*', originGuard());
  app.use('/api/*', limitBody(MAX_BODY_BYTES));

  app.onError((err, c) => {
    if (err instanceof InvalidInputError) {
      return c.json({ code: 'INVALID_INPUT', message: err.message, issues: err.issues }, 400);
    }
    if (err instanceof InvariantError) return c.json({ code: 'INVARIANT_VIOLATION', message: err.message }, 500);
    if (err instanceof StateError) return c.json({ code: err.code, message: err.message }, httpStatusFor(err.code));
    if (err instanceof PersistenceError) return c.json({ code: 'IO', message: err.message }, 500);
    return c.json({ code: 'INTERNAL', message: 'Unexpected server error.' }, 500);
  });
  app.notFound((c) => c.json({ code: 'NOT_FOUND', message: 'No such route.' }, 404));

  app.get('/health', (c) =>
    c.json({
      ok: true,
      app: 'pinpoint',
      version: deps.version,
      startedAt: deps.startedAt,
      stateDir: deps.stateDir ?? null,
      plans: store.summaries(presence, baseUrl),
      busy: polls.total() + sse.total() > 0,
    }),
  );

  app.post('/api/shutdown', (c) => {
    setTimeout(() => deps.onShutdown?.(), 0);
    return c.json({ ok: true });
  });

  app.get('/', (c) => c.html(renderHome(store.summaries(presence, baseUrl), assets)));

  app.get('/plans/:id', (c) => {
    const id = c.req.param('id');
    const state = store.get(id);
    if (state === undefined) {
      return c.html('<!doctype html><title>Not found</title><p>No plan with that id.</p>', 404);
    }
    return c.html(renderPage(state, assets, { presence: presence(id), undelivered: waitingQuestions(state), baseUrl }));
  });

  app.get('/fonts/:file', (c) => {
    const file = c.req.param('file');
    const path = Object.hasOwn(FONT_FILES, file) ? FONT_FILES[file] : undefined;
    if (path === undefined) return c.json({ code: 'NOT_FOUND', message: 'No such font.' }, 404);
    return new Response(Bun.file(path), {
      headers: { 'Content-Type': 'font/woff2', 'Cache-Control': FONT_CACHE_CONTROL },
    });
  });

  app.get('/api/plans', (c) => c.json({ plans: store.summaries(presence, baseUrl) }));

  app.put('/api/plans/:id', async (c) => {
    const id = c.req.param('id');
    const parsed = parsePlanInput(await readJson(c));
    if (!parsed.ok) throw new InvalidInputError(parsed.issues);
    if (parsed.value.id !== id) {
      throw new InvalidInputError([{ path: 'id', message: `body id ${parsed.value.id} does not match path id ${id}` }]);
    }
    const { state, replaced, dropped } = store.open(parsed.value);
    if (replaced) sse.broadcast(id, { event: 'plan', data: { revision: state.revision } });
    return c.json(
      {
        plan_id: id,
        url: planUrl(id),
        revision: state.revision,
        block_ids: state.plan.blocks.map((block) => block.id),
        dropped_messages: dropped,
      },
      replaced ? 200 : 201,
    );
  });

  app.get('/api/plans/:id', (c) => c.json(requirePlan(store, c.req.param('id'))));

  app.get('/api/plans/:id/blocks/:blockId', (c) => {
    const state = requirePlan(store, c.req.param('id'));
    const param = c.req.param('blockId');
    const asHtml = param.endsWith(HTML_BLOCK_SUFFIX);
    const blockId = asHtml ? param.slice(0, -HTML_BLOCK_SUFFIX.length) : param;
    const block = findBlock(state, blockId);
    if (block === undefined) throw new StateError('NOT_FOUND', `no block ${blockId} in plan ${state.plan.id}`);
    return asHtml ? c.body(render(block, state.plan.id), 200, { 'Content-Type': HTML_CONTENT_TYPE }) : c.json(block);
  });

  app.get('/api/plans/:id/sketches/:file', (c) => {
    const state = requirePlan(store, c.req.param('id'));
    const file = c.req.param('file');
    const messageId = file.endsWith(PNG_SUFFIX) ? file.slice(0, -PNG_SUFFIX.length) : '';
    const sketched = state.plan.blocks.some((block) => block.qa.some((x) => x.id === messageId && x.sketch));
    const png = sketched ? store.persistence.loadSketch(state.plan.id, messageId) : null;
    if (png === null) throw new StateError('NOT_FOUND', `no sketch ${file} in plan ${state.plan.id}`);
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  });

  app.post('/api/plans/:id/messages', async (c) => {
    const id = c.req.param('id');
    const parsed = parseBrowserMessage(await readJson(c));
    if (!parsed.ok) throw new InvalidInputError(parsed.issues);
    const png = parsed.value.sketch === undefined ? undefined : decodeSketch(parsed.value.sketch);
    const transition = store.apply(id, (s, now) => postMessage(s, parsed.value, now));
    const { state, message, duplicate } = transition;
    if (png !== undefined && message.sketch) store.persistence.saveSketch(id, message.id, png);
    const touchedId = transition.touched[0];
    const touched = touchedId === undefined ? undefined : findBlock(state, touchedId);
    publish(id, transition);
    if (!duplicate) polls.wake(id, 'message');
    return c.json({
      message,
      ...(touched === undefined ? {} : { block: { blockId: touched.id, rev: touched.rev, html: render(touched, id) } }),
      revision: state.revision,
      duplicate,
    });
  });

  app.post('/api/plans/:id/answers', async (c) => {
    const id = c.req.param('id');
    const parsed = parseAnswerInput(await readJson(c));
    if (!parsed.ok) throw new InvalidInputError(parsed.issues);
    const prev = requirePlan(store, id);
    const transition = applyChecked(id, (s, now) => attachAnswer(s, parsed.value, now));
    publish(id, transition);
    return receipt(c, id, 'answered', prev, transition);
  });

  app.post('/api/plans/:id/steps', async (c) => {
    const id = c.req.param('id');
    const parsed = parseStepsInput(await readJson(c));
    if (!parsed.ok) throw new InvalidInputError(parsed.issues);
    const prev = requirePlan(store, id);
    const transition = applyChecked(id, (s, now) => appendSteps(s, parsed.value, now));
    publish(id, transition);
    return receipt(c, id, 'steps-appended', prev, transition);
  });

  app.put('/api/plans/:id/blocks/:blockId', async (c) => {
    const id = c.req.param('id');
    const blockId = c.req.param('blockId');
    const parsed = parseBlockInput(await readJson(c));
    if (!parsed.ok) throw new InvalidInputError(parsed.issues);
    const prev = requirePlan(store, id);
    const acronyms = patchAcronyms(prev.plan.blocks, blockId, parsed.value);
    if (acronyms.length > 0) throw new InvalidInputError(acronyms);
    const transition = applyChecked(id, (s, now) => patchBlock(s, blockId, parsed.value, now));
    publish(id, transition);
    return receipt(c, id, 'patched', prev, transition);
  });

  app.post('/api/plans/:id/acks', async (c) => {
    const id = c.req.param('id');
    const parsed = parseAckIds(await readJson(c));
    if (!parsed.ok) throw new InvalidInputError(parsed.issues);
    const prev = requirePlan(store, id);
    const transition = applyChecked(id, (s, now) => ackMessages(s, parsed.value, now));
    publish(id, transition);
    return receipt(c, id, 'acked', prev, transition);
  });

  app.get('/api/plans/:id/events', (c) => {
    const id = c.req.param('id');
    const state = requirePlan(store, id);
    const hello: SseFrame = {
      event: 'hello',
      data: { revision: state.revision, presence: presence(id), review: state.review },
    };
    return sse.subscribe(id, c.req.raw.signal, [
      hello,
      ...replayFrames(state, parseSince(c.req.query('since')), render),
    ]);
  });

  app.get('/api/plans/:id/poll', (c) => {
    const id = c.req.param('id');
    requirePlan(store, id);
    const inv = c.req.query('inv') || DEFAULT_INVOCATION;
    const timeoutMs = clampTimeout(c.req.query('timeoutMs'), pollMaxWaitMs);
    const immediate = deliverPending(id, inv, polls.waiters(id) + 1);
    if (immediate !== null) return c.json(immediate);
    if (timeoutMs === 0) return c.json(waitingOutput(id, inv, polls.waiters(id) + 1));
    return polls.listen(id, timeoutMs, c.req.raw.signal, (why, { woken }) => {
      if (why === 'browser_closed') return browserClosedOutput(id, woken);
      return (why === 'message' ? deliverPending(id, inv, woken) : null) ?? waitingOutput(id, inv, woken);
    });
  });

  return {
    app,
    polls,
    sse,
    browserGrace,
    store,
    presence,
    busy: () => polls.total() + sse.total() > 0,
    close: () => {
      polls.close();
      sse.close();
      browserGrace.close();
    },
  };
}
