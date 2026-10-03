import type { Presence } from '../core/presence';
import type { PlanInput } from '../core/schema';
import { openPlan, pendingMessages, replacePlan } from '../core/state';
import { type PlanState, type PlanSummary, StateError, type Transition } from '../core/types';
import type { Persistence } from './persistence';

export class PlanStore {
  private readonly plans = new Map<string, PlanState>();

  constructor(
    private readonly persistence: Persistence,
    private readonly clock: () => Date,
  ) {
    for (const id of persistence.list()) {
      const state = persistence.load(id);
      if (state !== null) this.plans.set(id, state);
    }
  }

  get(id: string): PlanState | undefined {
    return this.plans.get(id);
  }

  has(id: string): boolean {
    return this.plans.has(id);
  }

  ids(): string[] {
    return [...this.plans.keys()].sort();
  }

  open(input: PlanInput): { state: PlanState; replaced: boolean; dropped: string[] } {
    const now = this.clock().toISOString();
    const existing = this.plans.get(input.id);
    if (existing === undefined) {
      const state = openPlan(input, now);
      this.commit(input.id, state);
      return { state, replaced: false, dropped: [] };
    }
    const { state, dropped } = replacePlan(existing, input, now);
    this.commit(input.id, state);
    return { state, replaced: true, dropped };
  }

  /** Saves the transition's state before returning; a save failure leaves the stored state untouched. */
  apply<T extends Transition>(id: string, fn: (s: PlanState, now: string) => T): T {
    const current = this.plans.get(id);
    if (current === undefined) throw new StateError('NOT_FOUND', `no plan ${id}`);
    const transition = fn(current, this.clock().toISOString());
    this.commit(id, transition.state);
    return transition;
  }

  summaries(presenceFor: (id: string) => Presence, baseUrl: string): PlanSummary[] {
    return this.ids().map((id) => {
      const state = this.plans.get(id) as PlanState;
      return {
        id,
        title: state.plan.title,
        url: `${baseUrl}/plans/${id}`,
        revision: state.revision,
        pending: pendingMessages(state).length,
        presence: presenceFor(id),
      };
    });
  }

  private commit(id: string, state: PlanState): void {
    this.persistence.save(id, state);
    this.plans.set(id, state);
  }
}
