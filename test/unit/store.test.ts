import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PlanInput, parsePlanInput } from '../../src/core/schema';
import { openPlan, postMessage } from '../../src/core/state';
import { StateError } from '../../src/core/types';
import { memoryPersistence, type Persistence, PersistenceError } from '../../src/server/persistence';
import { PlanStore } from '../../src/server/store';

const NOW = '2026-10-03T10:00:00.000Z';
const CLOCK = () => new Date('2026-10-03T12:34:56.789Z');
const DONE = { clientId: 'client-0001', kind: 'done', text: '' } as const;

function sampleInput(): PlanInput {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));
  const parsed = parsePlanInput(raw);
  if (!parsed.ok) throw new Error('fixture plan is invalid');
  return parsed.value;
}

function failingSave(): Persistence {
  const inner = memoryPersistence();
  return {
    ...inner,
    save() {
      throw new PersistenceError('disk full');
    },
  };
}

describe('PlanStore', () => {
  it('apply saves exactly once and returns the transition', () => {
    const p = memoryPersistence();
    const store = new PlanStore(p, CLOCK);
    store.open(sampleInput());
    p.saves = 0;

    const result = store.apply('auth-refresh', (s, now) => postMessage(s, DONE, now));

    expect(p.saves).toBe(1);
    expect(result.message.kind).toBe('done');
    expect(result.duplicate).toBe(false);
    expect(store.get('auth-refresh')?.review).toBe('handed-back');
    expect(p.load('auth-refresh')?.review).toBe('handed-back');
    expect(result.message.at).toBe('2026-10-03T12:34:56.789Z');
  });

  it('a failing save leaves the in-memory state unchanged', () => {
    const p = memoryPersistence();
    const before = openPlan(sampleInput(), NOW);
    p.save('auth-refresh', before);
    const failing: Persistence = { ...failingSave(), load: (id) => p.load(id), list: () => p.list() };
    const store = new PlanStore(failing, CLOCK);

    expect(() => store.apply('auth-refresh', (s, now) => postMessage(s, DONE, now))).toThrow(PersistenceError);
    expect(store.get('auth-refresh')).toEqual(before);

    expect(() => store.open(sampleInput())).toThrow(PersistenceError);
    expect(store.get('auth-refresh')).toEqual(before);
  });

  it('a failing save on a new plan does not register it', () => {
    const store = new PlanStore(failingSave(), CLOCK);

    expect(() => store.open(sampleInput())).toThrow(PersistenceError);
    expect(store.has('auth-refresh')).toBe(false);
  });

  it('apply on an unknown plan throws NOT_FOUND', () => {
    const store = new PlanStore(memoryPersistence(), CLOCK);

    expect(() => store.apply('nope', (s, now) => postMessage(s, DONE, now))).toThrow(StateError);
    try {
      store.apply('nope', (s, now) => postMessage(s, DONE, now));
    } catch (e) {
      expect((e as StateError).code).toBe('NOT_FOUND');
    }
  });

  it('loads every persisted plan at construction', () => {
    const p = memoryPersistence();
    p.save('auth-refresh', openPlan(sampleInput(), NOW));

    const store = new PlanStore(p, CLOCK);

    expect(store.has('auth-refresh')).toBe(true);
    expect(store.ids()).toEqual(['auth-refresh']);
    expect(store.get('missing')).toBeUndefined();
  });

  it('open creates a new plan, then replaces it on the same id', () => {
    const p = memoryPersistence();
    const store = new PlanStore(p, CLOCK);

    const first = store.open(sampleInput());
    expect(first.replaced).toBe(false);
    expect(first.dropped).toEqual([]);
    expect(first.state.revision).toBe(1);
    expect(p.saves).toBe(1);

    const second = store.open({ ...sampleInput(), title: 'Renamed' });
    expect(second.replaced).toBe(true);
    expect(second.state.revision).toBe(2);
    expect(store.get('auth-refresh')?.plan.title).toBe('Renamed');
    expect(p.saves).toBe(2);
  });

  it('summaries lists one entry per plan sorted by id', () => {
    const store = new PlanStore(memoryPersistence(), CLOCK);
    store.open({ ...sampleInput(), id: 'zeta' });
    store.open(sampleInput());
    store.apply('zeta', (s, now) =>
      postMessage(s, { clientId: 'client-0002', kind: 'choose', optionId: 'opt-a', text: '' }, now),
    );

    const summaries = store.summaries((id) => (id === 'zeta' ? 'working' : 'waiting'), 'http://127.0.0.1:4711');

    expect(summaries.map((s) => s.id)).toEqual(['auth-refresh', 'zeta']);
    expect(summaries[0]).toEqual({
      id: 'auth-refresh',
      title: 'Refresh expired auth tokens',
      url: 'http://127.0.0.1:4711/plans/auth-refresh',
      revision: 1,
      pending: 0,
      presence: 'waiting',
    });
    expect(summaries[1]?.presence).toBe('working');
    expect(summaries[1]?.pending).toBe(1);
  });
});
