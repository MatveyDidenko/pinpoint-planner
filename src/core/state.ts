import { type BrowserMessage, MAX_EXCHANGES, type OptionInput, type PlanInput } from './schema';
import {
  type Block,
  type Exchange,
  type FindingsBlock,
  type Letter,
  type Message,
  type OptionBlock,
  type PlanState,
  StateError,
  type Transition,
  type VerdictBlock,
} from './types';

const LETTERS: readonly Letter[] = ['A', 'B', 'C'];

export function blockLabel(block: Block): string {
  switch (block.kind) {
    case 'findings':
      return "What's already here";
    case 'option':
      return `Way ${block.letter} · ${block.name}`;
    case 'verdict':
      return 'The pick';
    case 'steps':
      return `Steps · Way ${block.letter} · ${block.optionName}`;
  }
}

export function findBlock(state: PlanState, id: string): Block | undefined {
  return state.plan.blocks.find((block) => block.id === id);
}

function freshBase(revision: number) {
  return { rev: 1, touchedAt: revision, qa: [] };
}

function deriveFindings(input: PlanInput['findings'], revision: number): FindingsBlock {
  const block: FindingsBlock = {
    ...freshBase(revision),
    id: 'findings',
    kind: 'findings',
    label: '',
    summary: input.summary,
    items: input.items,
    ...(input.diagram === undefined ? {} : { diagram: input.diagram }),
  };
  return { ...block, label: blockLabel(block) };
}

function deriveOption(input: OptionInput, letter: Letter, revision: number): OptionBlock {
  const block: OptionBlock = {
    ...freshBase(revision),
    id: input.id,
    kind: 'option',
    label: '',
    letter,
    name: input.name,
    pattern: input.pattern,
    diagram: input.diagram,
    reuses: input.reuses,
    cost: input.cost,
    recommended: input.recommended,
    ...(input.why === undefined ? {} : { why: input.why }),
    steps: { state: 'none' },
  };
  return { ...block, label: blockLabel(block) };
}

function deriveVerdict(recommended: OptionBlock, revision: number): VerdictBlock {
  const block: VerdictBlock = {
    ...freshBase(revision),
    id: 'verdict',
    kind: 'verdict',
    label: '',
    optionId: recommended.id,
    letter: recommended.letter,
    optionName: recommended.name,
    why: recommended.why ?? '',
  };
  return { ...block, label: blockLabel(block) };
}

export function deriveBlocks(input: PlanInput, revision: number): Block[] {
  const findings = deriveFindings(input.findings, revision);
  const options = input.options.map((option, i) => deriveOption(option, LETTERS[i] as Letter, revision));
  const recommended = options.find((option) => option.recommended) as OptionBlock;
  return [findings, ...options, deriveVerdict(recommended, revision)];
}

export function openPlan(input: PlanInput, now: string): PlanState {
  return {
    schemaVersion: 1,
    plan: { id: input.id, title: input.title, task: input.task, blocks: deriveBlocks(input, 1), openedAt: now },
    revision: 1,
    nextMessageSeq: 1,
    review: 'open',
    messages: [],
  };
}

export function pendingMessages(state: PlanState): Message[] {
  return state.messages
    .filter((message) => message.ackedAt === undefined)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

function replaceBlock(blocks: Block[], id: string, revision: number, change: (block: Block) => Block): Block[] {
  return blocks.map((block) =>
    block.id === id ? { ...change(block), rev: block.rev + 1, touchedAt: revision } : block,
  );
}

function appendMessage(state: PlanState, message: Message): PlanState {
  return {
    ...state,
    revision: state.revision + 1,
    nextMessageSeq: state.nextMessageSeq + 1,
    messages: [...state.messages, message],
  };
}

function assertOpen(state: PlanState): void {
  if (state.review === 'handed-back') throw new StateError('HANDED_BACK', 'the plan was already handed back');
}

function postAsk(state: PlanState, m: BrowserMessage, now: string): Transition & { message: Message } {
  assertOpen(state);
  const block = m.blockId === undefined ? undefined : findBlock(state, m.blockId);
  if (block === undefined) throw new StateError('NOT_FOUND', `no block ${m.blockId ?? '(none)'}`);
  if (block.qa.length >= MAX_EXCHANGES)
    throw new StateError('BLOCK_FULL', `block ${block.id} has ${MAX_EXCHANGES} questions`);

  const message: Message = {
    id: `m-${state.nextMessageSeq}`,
    clientId: m.clientId,
    kind: 'ask',
    blockId: block.id,
    text: m.text,
    ...(m.excerpt === undefined ? {} : { excerpt: m.excerpt }),
    at: now,
  };
  const exchange: Exchange = {
    id: message.id,
    question: m.text,
    ...(m.excerpt === undefined ? {} : { excerpt: m.excerpt }),
    askedAt: now,
    state: 'asked',
  };
  const next = appendMessage(state, message);

  return {
    state: {
      ...next,
      plan: {
        ...next.plan,
        blocks: replaceBlock(next.plan.blocks, block.id, next.revision, (b) => ({ ...b, qa: [...b.qa, exchange] })),
      },
    },
    touched: [block.id],
    message,
  };
}

function postChoose(state: PlanState, m: BrowserMessage, now: string): Transition & { message: Message } {
  assertOpen(state);
  const option = m.optionId === undefined ? undefined : findBlock(state, m.optionId);
  if (option === undefined) throw new StateError('NOT_FOUND', `no block ${m.optionId ?? '(none)'}`);
  if (option.kind !== 'option') throw new StateError('NOT_AN_OPTION', `block ${option.id} is not an option`);
  if (option.steps.state === 'ready') throw new StateError('STEPS_EXIST', `option ${option.id} already has steps`);

  const message: Message = {
    id: `m-${state.nextMessageSeq}`,
    clientId: m.clientId,
    kind: 'choose',
    blockId: option.id,
    optionId: option.id,
    text: '',
    at: now,
  };
  const next = appendMessage(state, message);

  return {
    state: {
      ...next,
      plan: {
        ...next.plan,
        blocks: replaceBlock(next.plan.blocks, option.id, next.revision, (b) =>
          b.kind === 'option' ? { ...b, steps: { state: 'requested' } } : b,
        ),
      },
    },
    touched: [option.id],
    message,
  };
}

function postDone(state: PlanState, m: BrowserMessage, now: string): Transition & { message: Message } {
  const message: Message = {
    id: `m-${state.nextMessageSeq}`,
    clientId: m.clientId,
    kind: 'done',
    text: '',
    at: now,
  };

  return { state: { ...appendMessage(state, message), review: 'handed-back' }, touched: [], message };
}

export function postMessage(
  state: PlanState,
  m: BrowserMessage,
  now: string,
): Transition & { message: Message; duplicate: boolean } {
  const existing = state.messages.find((message) => message.clientId === m.clientId);
  if (existing !== undefined) return { state, touched: [], message: existing, duplicate: true };

  if (m.kind === 'ask') return { ...postAsk(state, m, now), duplicate: false };
  if (m.kind === 'choose') return { ...postChoose(state, m, now), duplicate: false };
  return { ...postDone(state, m, now), duplicate: false };
}

export function markDelivered(state: PlanState, ids: string[], now: string): Transition {
  const delivering = new Set(ids);
  const revision = state.revision + 1;
  const isFlipping = (exchange: Exchange) => delivering.has(exchange.id) && exchange.state === 'asked';
  const touched = state.plan.blocks.filter((block) => block.qa.some(isFlipping)).map((block) => block.id);
  const blocks = touched.reduce(
    (acc, id) =>
      replaceBlock(acc, id, revision, (block) => ({
        ...block,
        qa: block.qa.map((exchange) => (isFlipping(exchange) ? { ...exchange, state: 'delivered' } : exchange)),
      })),
    state.plan.blocks,
  );

  return {
    state: {
      ...state,
      revision,
      plan: touched.length === 0 ? state.plan : { ...state.plan, blocks },
      messages: state.messages.map((message) =>
        delivering.has(message.id) && message.deliveredAt === undefined ? { ...message, deliveredAt: now } : message,
      ),
    },
    touched,
  };
}

function stampAcked(messages: Message[], ids: ReadonlySet<string>, now: string): Message[] {
  return messages.map((message) =>
    ids.has(message.id) && message.ackedAt === undefined ? { ...message, ackedAt: now } : message,
  );
}

export function ackMessages(state: PlanState, ids: string[], now: string): Transition {
  const acking = new Set(ids);
  const known = new Set(state.messages.map((message) => message.id));
  const unknown = ids.find((id) => !known.has(id));
  if (unknown !== undefined) throw new StateError('NOT_FOUND', `no message ${unknown}`);

  return {
    state: { ...state, revision: state.revision + 1, messages: stampAcked(state.messages, acking, now) },
    touched: [],
  };
}
