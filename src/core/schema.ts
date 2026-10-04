import { z } from 'zod';

export const PLAN_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const BLOCK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const NODE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const SENTENCE_MAX = 160;
export const ANSWER_MAX = 600;
export const EXCERPT_MAX = 200;
export const OPTION_MIN = 2;
export const OPTION_MAX = 4;
export const MAX_NODES = 8;
export const MAX_EDGES = 12;
export const MAX_FINDINGS = 12;
export const MAX_STEPS = 12;
export const MAX_EXCHANGES = 40;

const sentence = z.string().min(1).max(SENTENCE_MAX);

const isReservedBlockId = (id: string) => id === 'findings' || id === 'verdict' || id.startsWith('steps-');

const OptionIdSchema = z
  .string()
  .regex(BLOCK_ID)
  .refine((id) => !isReservedBlockId(id), { message: 'option id must not be findings, verdict or start with steps-' });

const StatusSchema = z.enum(['reused', 'new', 'changed', 'external']);

const GraphNodeSchema = z.object({
  id: z.string().regex(NODE_ID),
  label: z.string().min(1).max(40),
  status: StatusSchema,
});

const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().max(24).optional(),
});

export const GraphSchema = z
  .object({
    nodes: z.array(GraphNodeSchema).min(1).max(MAX_NODES),
    edges: z.array(GraphEdgeSchema).max(MAX_EDGES),
  })
  .superRefine((graph, ctx) => {
    const seen = new Set<string>();
    graph.nodes.forEach((node, i) => {
      if (seen.has(node.id)) ctx.addIssue({ code: 'custom', path: ['nodes', i, 'id'], message: 'duplicate node id' });
      seen.add(node.id);
    });
    graph.edges.forEach((edge, i) => {
      if (!seen.has(edge.from)) {
        ctx.addIssue({ code: 'custom', path: ['edges', i, 'from'], message: `unknown node ${edge.from}` });
      }
      if (!seen.has(edge.to)) {
        ctx.addIssue({ code: 'custom', path: ['edges', i, 'to'], message: `unknown node ${edge.to}` });
      } else if (edge.from === edge.to) {
        ctx.addIssue({ code: 'custom', path: ['edges', i, 'to'], message: 'an edge cannot point at its own node' });
      }
    });
  });

export const FindingSchema = z.object({
  path: z.string().min(1).max(120),
  role: z.enum(['reuse', 'touch', 'context']),
  note: sentence,
});

export const CostSchema = z.object({
  effort: z.enum(['S', 'M', 'L']),
  risk: z.enum(['low', 'medium', 'high']),
  note: sentence,
});

export const StepSchema = z.object({
  title: sentence,
  touches: z.array(z.string().min(1).max(120)).max(8),
  test: sentence,
});

export const FindingsInputSchema = z.object({
  summary: sentence,
  items: z.array(FindingSchema).min(1).max(MAX_FINDINGS),
  diagram: GraphSchema.optional(),
});

const OptionFieldsSchema = z.object({
  id: OptionIdSchema,
  name: z.string().min(1).max(60),
  pattern: z.string().min(1).max(60),
  diagram: GraphSchema,
  reuses: z.array(z.string().min(1).max(120)).max(8),
  cost: CostSchema,
  recommended: z.boolean(),
  why: sentence.optional(),
});

type OptionFields = z.infer<typeof OptionFieldsSchema>;

function requireWhyIffRecommended(option: OptionFields, ctx: z.RefinementCtx) {
  if (option.recommended && option.why === undefined) {
    ctx.addIssue({ code: 'custom', path: ['why'], message: 'the recommended option needs a why' });
  }
  if (!option.recommended && option.why !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['why'], message: 'only the recommended option carries a why' });
  }
}

export const OptionInputSchema = OptionFieldsSchema.superRefine(requireWhyIffRecommended);

export const PlanInputSchema = z
  .object({
    id: z.string().regex(PLAN_ID),
    title: z.string().min(1).max(80),
    task: sentence,
    findings: FindingsInputSchema,
    options: z.array(OptionInputSchema).min(OPTION_MIN).max(OPTION_MAX),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.options.forEach((option, i) => {
      if (seen.has(option.id)) {
        ctx.addIssue({ code: 'custom', path: ['options', i, 'id'], message: 'duplicate option id' });
      }
      seen.add(option.id);
    });
    if (plan.options.filter((option) => option.recommended).length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'exactly one option must be recommended' });
    }
  });

export const StepsInputSchema = z.object({
  optionId: z.string().regex(BLOCK_ID),
  steps: z.array(StepSchema).min(1).max(MAX_STEPS),
});

export const AnswerInputSchema = z.object({
  questionId: z.string().min(1),
  md: z.string().min(1).max(ANSWER_MAX),
  diagram: GraphSchema.optional(),
});

export const BlockInputSchema = z.discriminatedUnion('kind', [
  FindingsInputSchema.extend({ kind: z.literal('findings') }),
  OptionFieldsSchema.extend({ kind: z.literal('option') }).superRefine(requireWhyIffRecommended),
  z.object({ kind: z.literal('verdict'), why: sentence }),
]);

export const BrowserMessageSchema = z
  .object({
    clientId: z.string().regex(CLIENT_ID),
    kind: z.enum(['ask', 'choose', 'done']),
    blockId: z.string().regex(BLOCK_ID).optional(),
    optionId: z.string().regex(BLOCK_ID).optional(),
    threadId: z.string().regex(BLOCK_ID).optional(),
    text: z.string().max(ANSWER_MAX),
    excerpt: z.string().max(EXCERPT_MAX).optional(),
    proposal: GraphSchema.optional(),
  })
  .superRefine((message, ctx) => {
    if (message.kind === 'ask') {
      if (message.blockId === undefined)
        ctx.addIssue({ code: 'custom', path: ['blockId'], message: 'ask needs a blockId' });
      if (message.text.length === 0) ctx.addIssue({ code: 'custom', path: ['text'], message: 'ask needs text' });
      return;
    }
    if (message.kind === 'choose' && message.optionId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['optionId'], message: 'choose needs an optionId' });
    }
    if (message.threadId !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['threadId'], message: `${message.kind} takes no threadId` });
    }
    if (message.proposal !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['proposal'], message: `${message.kind} takes no proposal` });
    }
    if (message.text !== '') ctx.addIssue({ code: 'custom', path: ['text'], message: `${message.kind} takes no text` });
  });

export type Graph = z.infer<typeof GraphSchema>;
export type GraphNode = Graph['nodes'][number];
export type GraphEdge = Graph['edges'][number];
export type Status = GraphNode['status'];
export type Finding = z.infer<typeof FindingSchema>;
export type Cost = z.infer<typeof CostSchema>;
export type Step = z.infer<typeof StepSchema>;
export type FindingsInput = z.infer<typeof FindingsInputSchema>;
export type OptionInput = z.infer<typeof OptionInputSchema>;
export type PlanInput = z.infer<typeof PlanInputSchema>;
export type StepsInput = z.infer<typeof StepsInputSchema>;
export type AnswerInput = z.infer<typeof AnswerInputSchema>;
export type BlockInput = z.infer<typeof BlockInputSchema>;
export type BrowserMessage = z.infer<typeof BrowserMessageSchema>;

export type Issue = { path: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): Result<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  };
}

export const parsePlanInput = (raw: unknown) => parseWith(PlanInputSchema, raw);
export const parseStepsInput = (raw: unknown) => parseWith(StepsInputSchema, raw);
export const parseAnswerInput = (raw: unknown) => parseWith(AnswerInputSchema, raw);
export const parseBlockInput = (raw: unknown) => parseWith(BlockInputSchema, raw);
export const parseBrowserMessage = (raw: unknown) => parseWith(BrowserMessageSchema, raw);
