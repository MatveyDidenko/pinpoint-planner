import type { Presence } from '../core/presence';
import type { Message, PlanState } from '../core/types';

export type SseFrame =
  | { event: 'hello'; data: { revision: number; presence: Presence; review: PlanState['review'] } }
  | { event: 'block'; data: { blockId: string; rev: number; html: string; revision: number } }
  | { event: 'appended'; data: { blockId: string; after: string | null; rev: number; html: string; revision: number } }
  | { event: 'presence'; data: { presence: Presence; undelivered: number } }
  | { event: 'plan'; data: { revision: number } };

export interface Boot {
  planId: string;
  revision: number;
  presence: Presence;
  review: PlanState['review'];
}

export interface PostMessageResponse {
  message: Message;
  block?: { blockId: string; rev: number; html: string };
  revision: number;
  duplicate: boolean;
}

export type TabDot = 'waiting' | 'answer' | null;

export function optionTabName(tab: { label: string; recommended: boolean; chosen: boolean; dot: TabDot }): string {
  const extras = [
    tab.recommended ? 'recommended' : '',
    tab.chosen ? 'chosen' : '',
    tab.dot === 'waiting' ? 'question waiting' : tab.dot === 'answer' ? 'new answer' : '',
  ].filter((extra) => extra !== '');
  return [tab.label, ...extras].join(', ');
}

export function optionTabRule(shownId: string): string {
  return `.options > .block--option:not([data-block="${shownId}"]){display:none}`;
}

export function shouldApply(currentRev: number, incomingRev: number): boolean {
  return incomingRev > currentRev;
}
