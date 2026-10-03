import { describe, expect, it } from 'bun:test';
import { computePresence, PRESENCE_LABELS, type Presence, presenceLabel } from '../../src/core/presence';
import type { Message, PlanState } from '../../src/core/types';

function message(overrides: Partial<Message> = {}): Message {
  return { id: 'm1', clientId: 'c1', kind: 'ask', text: 'why?', at: '2026-10-03T10:00:00.000Z', ...overrides };
}

const undelivered = message({ id: 'm1' });
const deliveredUnacked = message({ id: 'm2', deliveredAt: '2026-10-03T10:01:00.000Z' });
const acked = message({
  id: 'm3',
  deliveredAt: '2026-10-03T10:01:00.000Z',
  ackedAt: '2026-10-03T10:02:00.000Z',
});

interface Row {
  name: string;
  review: PlanState['review'];
  messages: Message[];
  pollers: number;
  expected: Presence;
}

const rows: Row[] = [
  { name: 'handed back', review: 'handed-back', messages: [], pollers: 0, expected: 'handed-back' },
  { name: 'delivered and unacked', review: 'open', messages: [deliveredUnacked], pollers: 0, expected: 'working' },
  { name: 'poller attached, nothing in flight', review: 'open', messages: [acked], pollers: 1, expected: 'listening' },
  { name: 'no poller, nothing pending', review: 'open', messages: [], pollers: 0, expected: 'waiting' },
  { name: 'only undelivered messages', review: 'open', messages: [undelivered], pollers: 0, expected: 'waiting' },
  {
    name: 'delivered and unacked beats a poller',
    review: 'open',
    messages: [deliveredUnacked],
    pollers: 1,
    expected: 'working',
  },
];

describe('presence', () => {
  it.each(rows)('presence precedence table: $name', ({ review, messages, pollers, expected }) => {
    expect(computePresence({ review, messages, pollers })).toBe(expected);
  });

  it('handed-back wins even with a delivered unacked message and an attached poller', () => {
    expect(computePresence({ review: 'handed-back', messages: [deliveredUnacked], pollers: 2 })).toBe('handed-back');
  });

  it('labels match the spec strings', () => {
    expect(presenceLabel('waiting', 0)).toBe('Agent not on the line');
    expect(presenceLabel('waiting', 2)).toBe('Agent not on the line · 2 waiting');
    expect(presenceLabel('listening', 0)).toBe('Agent on the line');
    expect(presenceLabel('working', 0)).toBe('Agent working…');
    expect(presenceLabel('handed-back', 0)).toBe('Handed back to the agent');
  });

  it('appends the waiting count only for the waiting presence', () => {
    expect(presenceLabel('listening', 3)).toBe(PRESENCE_LABELS.listening);
    expect(presenceLabel('working', 3)).toBe(PRESENCE_LABELS.working);
    expect(presenceLabel('handed-back', 3)).toBe(PRESENCE_LABELS['handed-back']);
  });
});
