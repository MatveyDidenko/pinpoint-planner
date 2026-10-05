import type { ErrorCode, PollOutput, receiptOutput } from '../core/output';
import type { AnswerInput, BlockInput, Issue, PlanInput, StepsInput } from '../core/schema';
import type { Block, PlanState, PlanSummary } from '../core/types';
import { CliError } from './errors';

export type Receipt = ReturnType<typeof receiptOutput>;

export interface OpenResult {
  plan_id: string;
  url: string;
  revision: number;
  block_ids: string[];
  dropped_messages: string[];
  replaced: boolean;
}

export interface HealthResponse {
  ok: boolean;
  app: string;
  version: string;
  startedAt: string;
  stateDir: string | null;
  plans: PlanSummary[];
  busy: boolean;
}

interface ErrorBody {
  code: string;
  message: string;
  issues?: Issue[];
}

const CLI_ERROR_CODES: Record<ErrorCode, true> = {
  BAD_ARGS: true,
  INVALID_INPUT: true,
  NOT_FOUND: true,
  NOT_AN_OPTION: true,
  STEPS_EXIST: true,
  ALREADY_ANSWERED: true,
  BLOCK_FULL: true,
  THREAD_BUSY: true,
  HANDED_BACK: true,
  RECOMMENDED_LOCKED: true,
  KIND_MISMATCH: true,
  SERVER_UNREACHABLE: true,
  POLL_INTERRUPTED: true,
  INVARIANT_VIOLATION: true,
  IO: true,
};

const BODY_SNIPPET_CHARS = 120;
const CREATED_STATUS = 201;

function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(CLI_ERROR_CODES, code);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseErrorBody(text: string): ErrorBody | undefined {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null) return undefined;
    const { code, message, issues } = body as Partial<ErrorBody>;
    if (typeof code !== 'string' || typeof message !== 'string') return undefined;
    return { code, message, ...(Array.isArray(issues) ? { issues } : {}) };
  } catch {
    return undefined;
  }
}

async function errorFrom(res: Response): Promise<CliError> {
  const text = await res.text().catch(() => '');
  const body = parseErrorBody(text);
  if (body === undefined) {
    const snippet = text.slice(0, BODY_SNIPPET_CHARS);
    return new CliError(
      'IO',
      `The helper answered ${res.status} with an unreadable body: ${snippet}`,
      undefined,
      res.status,
    );
  }
  if (!isErrorCode(body.code)) {
    return new CliError('IO', `${body.code}: ${body.message}`, body.issues, res.status);
  }
  return new CliError(body.code, body.message, body.issues, res.status);
}

/**
 * HTTP client for the helper's agent routes; every failure surfaces as a `CliError`.
 *
 * `inv` is bound once and sent as the `inv` query param on the routes that build a server-side
 * `next_step` (poll, answer, appendSteps, patchBlock, ack).
 */
export function apiClient(fetchFn: typeof fetch, baseUrl: string, inv?: string) {
  const withInv = (path: string, extra: Record<string, string> = {}): string => {
    const query = new URLSearchParams(extra);
    if (inv !== undefined) query.set('inv', inv);
    const qs = query.toString();
    return qs === '' ? path : `${path}?${qs}`;
  };

  const send = async (path: string, init?: RequestInit): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, init);
    } catch (error) {
      throw new CliError('SERVER_UNREACHABLE', `Could not reach the helper at ${baseUrl}: ${describe(error)}`);
    }
    if (!res.ok) throw await errorFrom(res);
    return res;
  };

  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await send(path, init);
    try {
      return await res.json();
    } catch (error) {
      throw new CliError('IO', `The helper sent an unreadable body: ${describe(error)}`, undefined, res.status);
    }
  };

  const withBody = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const plan = (id: string) => `/api/plans/${encodeURIComponent(id)}`;

  return {
    health: () => json<HealthResponse>('/health'),

    listPlans: async (): Promise<PlanSummary[]> => (await json<{ plans: PlanSummary[] }>('/api/plans')).plans,

    openPlan: async (id: string, input: PlanInput): Promise<OpenResult> => {
      const res = await send(plan(id), withBody('PUT', input));
      try {
        const body: Omit<OpenResult, 'replaced'> = await res.json();
        return { ...body, replaced: res.status !== CREATED_STATUS };
      } catch (error) {
        throw new CliError('IO', `The helper sent an unreadable body: ${describe(error)}`, undefined, res.status);
      }
    },

    getPlan: (id: string) => json<PlanState>(plan(id)),

    getBlock: (id: string, blockId: string) => json<Block>(`${plan(id)}/blocks/${encodeURIComponent(blockId)}`),

    answer: (id: string, input: AnswerInput) => json<Receipt>(withInv(`${plan(id)}/answers`), withBody('POST', input)),

    appendSteps: (id: string, input: StepsInput) =>
      json<Receipt>(withInv(`${plan(id)}/steps`), withBody('POST', input)),

    patchBlock: (id: string, blockId: string, input: BlockInput) =>
      json<Receipt>(withInv(`${plan(id)}/blocks/${encodeURIComponent(blockId)}`), withBody('PUT', input)),

    ack: (id: string, ids: string[]) => json<Receipt>(withInv(`${plan(id)}/acks`), withBody('POST', { ids })),

    /** A body that fails to arrive or parse after the headers were accepted is `POLL_INTERRUPTED`. */
    poll: async (id: string, timeoutMs?: number, seen?: Iterable<string>): Promise<PollOutput> => {
      const extra: Record<string, string> = timeoutMs === undefined ? {} : { timeoutMs: String(timeoutMs) };
      if (seen !== undefined) Object.assign(extra, { watch: '1', seen: [...seen].join(',') });
      const res = await send(withInv(`${plan(id)}/poll`, extra));
      try {
        const text = await res.text();
        if (text.trim() === '') throw new Error('the response body was empty');
        return JSON.parse(text);
      } catch (error) {
        throw new CliError(
          'POLL_INTERRUPTED',
          `The poll response was cut off: ${describe(error)}`,
          undefined,
          res.status,
        );
      }
    },

    shutdown: () => json<{ ok: boolean }>('/api/shutdown', { method: 'POST' }),
  };
}
