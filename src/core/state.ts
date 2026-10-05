import {
  type AnswerInput,
  type BlockInput,
  type BrowserMessage,
  type ContextInput,
  type Graph,
  MAX_EXCHANGES,
  type OptionInput,
  type PlanInput,
  type StepsInput,
} from './schema';
import {
  type Block,
  type ContextBlock,
  type Exchange,
  type FindingsBlock,
  type Letter,
  type Message,
  type OptionBlock,
  type PlanState,
  StateError,
  type StepsBlock,
  type Transition,
  type VerdictBlock,
} from './types';

const LETTERS: readonly Letter[] = ['A', 'B', 'C', 'D'];

export function blockLabel(block: Block): string {
  switch (block.kind) {
    case 'context':
      return 'How it works today';
    case 'findings':
      return "What's already here";
    case 'option':
      return `Way ${block.letter} · ${block.name}`;
    case 'verdict':
      return 'Recommended';
    case 'steps':
      return `Steps · Way ${block.letter} · ${block.optionName}`;
  }
}

export function findBlock(state: PlanState, id: string): Block | undefined {
  return state.plan.blocks.find((block) => block.id === id);
}

export function blockDiagram(block: Block): Graph | undefined {
  return block.kind === 'option' || block.kind === 'findings' ? block.diagram : undefined;
}

function freshBase(revision: number) {
  return { rev: 1, touchedAt: revision, qa: [] };
}

function deriveContext(input: ContextInput, revision: number): ContextBlock {
  const block: ContextBlock = {
    ...freshBase(revision),
    id: 'context',
    kind: 'context',
    label: '',
    summary: input.summary,
    terms: input.terms,
    flows: input.flows,
  };
  return { ...block, label: blockLabel(block) };
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
    summary: input.summary,
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
  const context = input.context === undefined ? [] : [deriveContext(input.context, revision)];
  return [...context, findings, ...options, deriveVerdict(recommended, revision)];
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
  if (state.review === 'handed-back') throw new StateError('HANDED_BACK', 'This plan was already handed back.');
}

function postAsk(state: PlanState, m: BrowserMessage, now: string): Transition & { message: Message } {
  assertOpen(state);
  const block = m.blockId === undefined ? undefined : findBlock(state, m.blockId);
  if (block === undefined) throw new StateError('NOT_FOUND', `no block ${m.blockId ?? '(none)'}`);
  if (block.qa.length >= MAX_EXCHANGES)
    throw new StateError('BLOCK_FULL', `This card holds ${MAX_EXCHANGES} questions, the most it can take.`);
  if (m.threadId !== undefined) {
    const last = block.qa.findLast((exchange) => exchange.threadId === m.threadId);
    if (last === undefined) throw new StateError('NOT_FOUND', `no thread ${m.threadId} on block ${block.id}`);
    if (last.state !== 'answered') throw new StateError('THREAD_BUSY', 'Wait for the answer before replying.');
  }
  if (m.proposal !== undefined && blockDiagram(block) === undefined) {
    throw new StateError('KIND_MISMATCH', `block ${block.id} has no diagram to edit`);
  }

  const id = `m-${state.nextMessageSeq}`;
  const threadId = m.threadId ?? id;
  const proposal = m.proposal === undefined ? {} : { proposal: m.proposal };
  const sketch = m.sketch === undefined ? {} : { sketch: true as const };
  const message: Message = {
    id,
    clientId: m.clientId,
    kind: 'ask',
    blockId: block.id,
    text: m.text,
    ...(m.excerpt === undefined ? {} : { excerpt: m.excerpt }),
    ...proposal,
    ...sketch,
    at: now,
    threadId,
  };
  const exchange: Exchange = {
    id,
    threadId,
    question: m.text,
    ...(m.excerpt === undefined ? {} : { excerpt: m.excerpt }),
    ...proposal,
    ...sketch,
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

export function attachAnswer(state: PlanState, answer: AnswerInput, now: string): Transition {
  const block = state.plan.blocks.find((b) => b.qa.some((exchange) => exchange.id === answer.questionId));
  const exchange = block?.qa.find((e) => e.id === answer.questionId);
  if (block === undefined || exchange === undefined)
    throw new StateError('NOT_FOUND', `no question ${answer.questionId}`);
  if (exchange.state === 'answered') throw new StateError('ALREADY_ANSWERED', `question ${exchange.id} is answered`);

  const revision = state.revision + 1;
  const answered: Exchange = {
    ...exchange,
    state: 'answered',
    answer: { md: answer.md, ...(answer.diagram === undefined ? {} : { diagram: answer.diagram }), at: now },
  };

  return {
    state: {
      ...state,
      revision,
      plan: {
        ...state.plan,
        blocks: replaceBlock(state.plan.blocks, block.id, revision, (b) => ({
          ...b,
          qa: b.qa.map((e) => (e.id === exchange.id ? answered : e)),
        })),
      },
      messages: stampAcked(state.messages, new Set([answer.questionId]), now),
    },
    touched: [block.id],
  };
}

export function appendSteps(state: PlanState, input: StepsInput, now: string): Transition {
  const option = findBlock(state, input.optionId);
  if (option === undefined) throw new StateError('NOT_FOUND', `no block ${input.optionId}`);
  if (option.kind !== 'option') throw new StateError('NOT_AN_OPTION', `block ${option.id} is not an option`);
  if (option.steps.state === 'ready') throw new StateError('STEPS_EXIST', `option ${option.id} already has steps`);

  const revision = state.revision + 1;
  const stepsId = `steps-${option.id}`;
  const previousLastId = state.plan.blocks[state.plan.blocks.length - 1]?.id ?? null;
  const base: StepsBlock = {
    id: stepsId,
    kind: 'steps',
    label: '',
    optionId: option.id,
    letter: option.letter,
    optionName: option.name,
    steps: input.steps,
    rev: 1,
    touchedAt: revision,
    qa: [],
  };
  const stepsBlock: StepsBlock = { ...base, label: blockLabel(base) };
  const chooseIds = state.messages
    .filter((message) => message.kind === 'choose' && message.optionId === option.id)
    .map((message) => message.id);

  return {
    state: {
      ...state,
      revision,
      plan: {
        ...state.plan,
        blocks: [
          ...replaceBlock(state.plan.blocks, option.id, revision, (b) =>
            b.kind === 'option' ? { ...b, steps: { state: 'ready', blockId: stepsId } } : b,
          ),
          stepsBlock,
        ],
      },
      messages: stampAcked(state.messages, new Set(chooseIds), now),
    },
    touched: [option.id, stepsId],
    appended: { blockId: stepsId, after: previousLastId },
  };
}

function applyPatch(block: Block, input: BlockInput, revision: number): Block {
  if (input.kind === 'context' && block.kind === 'context') {
    return { ...deriveContext(input, revision), qa: block.qa };
  }
  if (input.kind === 'findings' && block.kind === 'findings') {
    return { ...deriveFindings(input, revision), id: block.id, qa: block.qa };
  }
  if (input.kind === 'option' && block.kind === 'option') {
    if (input.recommended !== block.recommended)
      throw new StateError('RECOMMENDED_LOCKED', `option ${block.id} cannot change its recommended flag`);
    return { ...deriveOption(input, block.letter, revision), id: block.id, qa: block.qa, steps: block.steps };
  }
  if (input.kind === 'verdict' && block.kind === 'verdict') return { ...block, why: input.why };
  throw new StateError('KIND_MISMATCH', `block ${block.id} is a ${block.kind}, not a ${input.kind}`);
}

export function patchBlock(state: PlanState, blockId: string, input: BlockInput, _now: string): Transition {
  const block = findBlock(state, blockId);
  if (block === undefined) throw new StateError('NOT_FOUND', `no block ${blockId}`);

  const revision = state.revision + 1;
  const patched = applyPatch(block, input, revision);
  const blocks = replaceBlock(state.plan.blocks, blockId, revision, () => patched);
  const verdictStale =
    block.kind === 'option' &&
    patched.kind === 'option' &&
    patched.recommended &&
    (patched.name !== block.name || patched.why !== block.why);
  const finalBlocks = verdictStale
    ? replaceBlock(blocks, 'verdict', revision, (verdict) => ({ ...deriveVerdict(patched, revision), qa: verdict.qa }))
    : blocks;

  return {
    state: { ...state, revision, plan: { ...state.plan, blocks: finalBlocks } },
    touched: verdictStale ? [blockId, 'verdict'] : [blockId],
  };
}

export function replacePlan(state: PlanState, input: PlanInput, now: string): Transition & { dropped: string[] } {
  const revision = state.revision + 1;
  const blocks = deriveBlocks(input, revision).map((block) => {
    const previous = findBlock(state, block.id);
    return previous === undefined ? block : { ...block, qa: previous.qa, rev: previous.rev + 1 };
  });
  const surviving = new Set(blocks.map((block) => block.id));
  const dropped = state.messages
    .filter(
      (message) =>
        message.ackedAt === undefined &&
        ((message.blockId !== undefined && !surviving.has(message.blockId)) ||
          (message.optionId !== undefined && !surviving.has(message.optionId))),
    )
    .map((message) => message.id);

  return {
    state: {
      ...state,
      revision,
      plan: { ...state.plan, title: input.title, task: input.task, blocks },
      messages: stampAcked(state.messages, new Set(dropped), now),
    },
    touched: blocks.map((block) => block.id),
    dropped,
  };
}
