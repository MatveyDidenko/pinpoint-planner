import type { Presence } from './presence';
import type { Cost, Finding, Graph, Step } from './schema';

export type Letter = 'A' | 'B' | 'C';

export interface Exchange {
  id: string;
  question: string;
  excerpt?: string;
  askedAt: string;
  state: 'asked' | 'delivered' | 'answered';
  answer?: { md: string; diagram?: Graph; at: string };
}

export interface BlockBase {
  id: string;
  kind: Block['kind'];
  label: string;
  rev: number;
  touchedAt: number;
  qa: Exchange[];
}

export interface FindingsBlock extends BlockBase {
  kind: 'findings';
  summary: string;
  items: Finding[];
  diagram?: Graph;
}

export interface OptionBlock extends BlockBase {
  kind: 'option';
  letter: Letter;
  name: string;
  pattern: string;
  diagram: Graph;
  reuses: string[];
  cost: Cost;
  recommended: boolean;
  why?: string;
  steps: { state: 'none' | 'requested' | 'ready'; blockId?: string };
}

export interface VerdictBlock extends BlockBase {
  kind: 'verdict';
  optionId: string;
  letter: Letter;
  optionName: string;
  why: string;
}

export interface StepsBlock extends BlockBase {
  kind: 'steps';
  optionId: string;
  letter: Letter;
  optionName: string;
  steps: Step[];
}

export type Block = FindingsBlock | OptionBlock | VerdictBlock | StepsBlock;

export interface Message {
  id: string;
  clientId: string;
  kind: 'ask' | 'choose' | 'done';
  blockId?: string;
  optionId?: string;
  text: string;
  excerpt?: string;
  at: string;
  deliveredAt?: string;
  ackedAt?: string;
}

export interface PlanState {
  schemaVersion: 1;
  plan: { id: string; title: string; task: string; blocks: Block[]; openedAt: string };
  revision: number;
  nextMessageSeq: number;
  review: 'open' | 'handed-back';
  messages: Message[];
}

export interface Transition {
  state: PlanState;
  touched: string[];
  appended?: { blockId: string; after: string | null };
}

export type StateErrorCode =
  | 'NOT_FOUND'
  | 'BLOCK_FULL'
  | 'NOT_AN_OPTION'
  | 'STEPS_EXIST'
  | 'HANDED_BACK'
  | 'ALREADY_ANSWERED'
  | 'KIND_MISMATCH'
  | 'RECOMMENDED_LOCKED';

export class StateError extends Error {
  readonly code: StateErrorCode;

  constructor(code: StateErrorCode, message: string) {
    super(message);
    this.name = 'StateError';
    this.code = code;
  }
}

export interface PlanSummary {
  id: string;
  title: string;
  url: string;
  revision: number;
  pending: number;
  presence: Presence;
}
