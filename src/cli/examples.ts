import type { AnswerInput, BlockInput, PlanInput, StepsInput } from '../core/schema';

const plan: PlanInput = {
  id: 'auth-refresh',
  title: 'Refresh expired auth tokens',
  task: 'Refresh expired auth tokens without logging the user out',
  findings: {
    summary: 'Every request already goes through one fetch wrapper, and the session store owns the token pair.',
    items: [
      {
        path: 'src/api/client.ts',
        role: 'reuse',
        note: 'The single fetch wrapper every request passes through, so it sees each 401 first.',
      },
      {
        path: 'src/auth/session.ts',
        role: 'touch',
        note: 'Holds the access and refresh tokens and needs a way to swap in a renewed pair.',
      },
      {
        path: 'src/auth/storage.ts',
        role: 'context',
        note: 'Persists the token pair to disk, so a renewed token must be written back here.',
      },
      {
        path: 'src/api/retry.ts',
        role: 'reuse',
        note: 'Already retries idempotent requests with backoff and can be reused for the replayed call.',
      },
    ],
    diagram: {
      nodes: [
        {
          id: 'caller',
          label: 'Call site',
          status: 'external',
        },
        {
          id: 'client',
          label: 'Fetch wrapper',
          status: 'reused',
        },
        {
          id: 'retry',
          label: 'Retry helper',
          status: 'reused',
        },
        {
          id: 'session',
          label: 'Session store',
          status: 'changed',
        },
        {
          id: 'storage',
          label: 'Token storage',
          status: 'reused',
        },
      ],
      edges: [
        {
          from: 'caller',
          to: 'client',
        },
        {
          from: 'client',
          to: 'retry',
        },
        {
          from: 'client',
          to: 'session',
          label: 'reads token',
        },
        {
          from: 'session',
          to: 'storage',
        },
      ],
    },
  },
  options: [
    {
      id: 'opt-a',
      name: 'Refresh inside the fetch wrapper',
      pattern: 'Interceptor \u00b7 retry once',
      diagram: {
        nodes: [
          {
            id: 'caller',
            label: 'Call site',
            status: 'external',
          },
          {
            id: 'wrapper',
            label: 'Fetch wrapper',
            status: 'changed',
          },
          {
            id: 'refresh',
            label: 'Refresh call',
            status: 'new',
          },
          {
            id: 'session',
            label: 'Session store',
            status: 'reused',
          },
          {
            id: 'api',
            label: 'API',
            status: 'external',
          },
        ],
        edges: [
          {
            from: 'caller',
            to: 'wrapper',
          },
          {
            from: 'wrapper',
            to: 'api',
          },
          {
            from: 'wrapper',
            to: 'refresh',
            label: 'on 401',
          },
          {
            from: 'refresh',
            to: 'session',
          },
        ],
      },
      reuses: ['src/api/client.ts', 'src/api/retry.ts'],
      cost: {
        effort: 'S',
        risk: 'low',
        note: 'One file changes and every caller gets the fix without edits.',
      },
      recommended: true,
      why: 'It reuses the one place every request already passes through',
    },
    {
      id: 'opt-b',
      name: 'Proactive refresh timer',
      pattern: 'Background renewal',
      diagram: {
        nodes: [
          {
            id: 'timer',
            label: 'Refresh timer',
            status: 'new',
          },
          {
            id: 'refresh',
            label: 'Refresh call',
            status: 'new',
          },
          {
            id: 'storage',
            label: 'Token storage',
            status: 'reused',
          },
          {
            id: 'session',
            label: 'Session store',
            status: 'changed',
          },
          {
            id: 'wrapper',
            label: 'Fetch wrapper',
            status: 'reused',
          },
        ],
        edges: [
          {
            from: 'timer',
            to: 'refresh',
            label: 'before expiry',
          },
          {
            from: 'refresh',
            to: 'storage',
          },
          {
            from: 'storage',
            to: 'session',
          },
          {
            from: 'session',
            to: 'timer',
            label: 'reschedule',
          },
          {
            from: 'wrapper',
            to: 'session',
          },
        ],
      },
      reuses: ['src/auth/storage.ts'],
      cost: {
        effort: 'M',
        risk: 'medium',
        note: 'A long-lived timer needs care around sleeping laptops and multiple tabs.',
      },
      recommended: false,
    },
    {
      id: 'opt-c',
      name: 'Refresh at each call site',
      pattern: 'Per-call retry',
      diagram: {
        nodes: [
          {
            id: 'caller',
            label: 'Each call site',
            status: 'changed',
          },
          {
            id: 'retry',
            label: 'Retry helper',
            status: 'reused',
          },
          {
            id: 'refresh',
            label: 'Refresh call',
            status: 'new',
          },
          {
            id: 'api',
            label: 'API',
            status: 'external',
          },
        ],
        edges: [
          {
            from: 'caller',
            to: 'retry',
          },
          {
            from: 'retry',
            to: 'refresh',
            label: 'on 401',
          },
          {
            from: 'retry',
            to: 'api',
          },
        ],
      },
      reuses: ['src/api/retry.ts'],
      cost: {
        effort: 'L',
        risk: 'medium',
        note: 'Dozens of call sites change and a new one can silently forget the retry.',
      },
      recommended: false,
    },
  ],
};

const steps: StepsInput = {
  optionId: 'opt-a',
  steps: [
    {
      title: 'Detect a 401 in the fetch wrapper and pause the failed request',
      touches: ['src/api/client.ts'],
      test: 'A mocked 401 response makes the wrapper call the refresh function once.',
    },
    {
      title: 'Add a refresh call that swaps in the renewed token pair',
      touches: ['src/auth/session.ts', 'src/auth/storage.ts'],
      test: 'After a successful refresh the session store and storage both hold the new tokens.',
    },
    {
      title: 'Replay the paused request once through the existing retry helper',
      touches: ['src/api/client.ts', 'src/api/retry.ts'],
      test: 'A second 401 after the refresh surfaces to the caller instead of looping.',
    },
  ],
};

const answer: AnswerInput = {
  questionId: 'm-1',
  md: 'The timer reschedules itself after every successful refresh, so a **sleeping laptop** wakes up with at most one missed renewal and recovers on the next tick.',
  diagram: {
    nodes: [
      {
        id: 'wake',
        label: 'Laptop wakes',
        status: 'external',
      },
      {
        id: 'timer',
        label: 'Refresh timer',
        status: 'new',
      },
      {
        id: 'refresh',
        label: 'Refresh call',
        status: 'new',
      },
    ],
    edges: [
      {
        from: 'wake',
        to: 'timer',
        label: 'overdue',
      },
      {
        from: 'timer',
        to: 'refresh',
      },
    ],
  },
};

const block: BlockInput = {
  kind: 'option',
  id: 'opt-b',
  name: 'Proactive refresh timer',
  pattern: 'Background renewal',
  diagram: {
    nodes: [
      {
        id: 'timer',
        label: 'Refresh timer',
        status: 'new',
      },
      {
        id: 'lock',
        label: 'Tab lock',
        status: 'new',
      },
      {
        id: 'refresh',
        label: 'Refresh call',
        status: 'new',
      },
      {
        id: 'storage',
        label: 'Token storage',
        status: 'reused',
      },
      {
        id: 'session',
        label: 'Session store',
        status: 'changed',
      },
    ],
    edges: [
      {
        from: 'timer',
        to: 'lock',
        label: 'one tab only',
      },
      {
        from: 'lock',
        to: 'refresh',
      },
      {
        from: 'refresh',
        to: 'storage',
      },
      {
        from: 'storage',
        to: 'session',
      },
      {
        from: 'session',
        to: 'timer',
        label: 'reschedule',
      },
    ],
  },
  reuses: ['src/auth/storage.ts'],
  cost: {
    effort: 'M',
    risk: 'medium',
    note: 'A tab lock stops duplicate refreshes but adds one more moving part.',
  },
  recommended: false,
};

export const EXAMPLES = { plan, steps, answer, block };

export type ExampleKind = keyof typeof EXAMPLES;

export function isExampleKind(value: string): value is ExampleKind {
  return Object.hasOwn(EXAMPLES, value);
}
