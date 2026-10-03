import type { Message, PlanState } from './types';

export type Presence = 'waiting' | 'listening' | 'working' | 'handed-back';

export const PRESENCE_LABELS: Record<Presence, string> = {
  waiting: 'Agent not on the line',
  listening: 'Agent on the line',
  working: 'Agent working…',
  'handed-back': 'Handed back to the agent',
};

export function computePresence(input: {
  review: PlanState['review'];
  messages: Message[];
  pollers: number;
}): Presence {
  if (input.review === 'handed-back') return 'handed-back';
  if (input.messages.some((m) => m.deliveredAt && !m.ackedAt)) return 'working';
  if (input.pollers > 0) return 'listening';
  return 'waiting';
}

export function presenceLabel(p: Presence, undelivered: number): string {
  if (p === 'waiting' && undelivered > 0) return `${PRESENCE_LABELS.waiting} · ${undelivered} waiting`;
  return PRESENCE_LABELS[p];
}
