import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { parsePlanInput } from '../../src/core/schema';
import { attachAnswer, openPlan, postMessage } from '../../src/core/state';
import type { PlanState } from '../../src/core/types';
import { filePersistence, memoryPersistence, PersistenceError } from '../../src/server/persistence';

const NOW = '2026-10-03T10:00:00.000Z';
const CLOCK = () => new Date('2026-10-03T12:34:56.789Z');

function sampleState(): PlanState {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));
  const parsed = parsePlanInput(raw);
  if (!parsed.ok) throw new Error('fixture plan is invalid');
  return openPlan(parsed.value, NOW);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pinpoint-persistence-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('filePersistence', () => {
  it('save then load from a new filePersistence round-trips the state and leaves no tmp file', () => {
    const state = sampleState();
    filePersistence(dir, CLOCK).save(state.plan.id, state);

    const reloaded = filePersistence(dir, CLOCK).load(state.plan.id);

    expect(reloaded).toEqual(state);
    expect(readdirSync(join(dir, 'plans'))).toEqual([`${state.plan.id}.json`]);
  });

  it('a corrupt file is renamed with a corrupt suffix and load returns null', () => {
    mkdirSync(join(dir, 'plans'));
    writeFileSync(join(dir, 'plans', 'p1.json'), '{not json');

    const loaded = filePersistence(dir, CLOCK).load('p1');

    expect(loaded).toBeNull();
    expect(readdirSync(join(dir, 'plans'))).toEqual(['p1.json.corrupt-2026-10-03T12-34-56.789Z']);
  });

  it('a wrong schemaVersion loads as null', () => {
    mkdirSync(join(dir, 'plans'));
    writeFileSync(join(dir, 'plans', 'p1.json'), JSON.stringify({ ...sampleState(), schemaVersion: 2 }));

    expect(filePersistence(dir, CLOCK).load('p1')).toBeNull();
  });

  it('a plan saved without thread ids loads with each exchange as its own thread', () => {
    let state = sampleState();
    state = postMessage(
      state,
      { clientId: 'client-01', kind: 'ask', blockId: 'opt-b', text: 'Why a timer?' },
      NOW,
    ).state;
    state = postMessage(
      state,
      { clientId: 'client-02', kind: 'ask', blockId: 'opt-b', text: 'And on wake?' },
      NOW,
    ).state;
    state = postMessage(state, { clientId: 'client-03', kind: 'choose', optionId: 'opt-a', text: '' }, NOW).state;
    const legacy = JSON.stringify(state, (key, value) => (key === 'threadId' ? undefined : value));
    mkdirSync(join(dir, 'plans'));
    writeFileSync(join(dir, 'plans', 'p1.json'), legacy);

    expect(legacy).not.toContain('threadId');
    expect(filePersistence(dir, CLOCK).load('p1')).toEqual(state);
  });

  it('a plan saved with thread ids loads unchanged', () => {
    let state = sampleState();
    state = postMessage(
      state,
      { clientId: 'client-01', kind: 'ask', blockId: 'opt-b', text: 'Why a timer?' },
      NOW,
    ).state;
    state = attachAnswer(state, { questionId: 'm-1', md: 'It renews before expiry.' }, NOW).state;
    state = postMessage(
      state,
      { clientId: 'client-02', kind: 'ask', blockId: 'opt-b', text: 'Even when asleep?', threadId: 'm-1' },
      NOW,
    ).state;
    filePersistence(dir, CLOCK).save('p1', state);

    expect(filePersistence(dir, CLOCK).load('p1')).toEqual(state);
  });

  it('load of a missing file is null and list of a missing dir is empty', () => {
    const p = filePersistence(dir, CLOCK);

    expect(p.load('nope')).toBeNull();
    expect(p.list()).toEqual([]);
    expect(existsSync(join(dir, 'plans'))).toBe(false);
  });

  it('list returns sorted ids of json files only', () => {
    const p = filePersistence(dir, CLOCK);
    const state = sampleState();
    p.save('b', state);
    p.save('a', state);
    writeFileSync(join(dir, 'plans', 'c.json.tmp'), '{}');
    writeFileSync(join(dir, 'plans', 'd.json.corrupt-2026-10-03T12-34-56.789Z'), '{');

    expect(p.list()).toEqual(['a', 'b']);
  });

  it('saveSketch writes atomically and sketchPath is null for an unknown message', () => {
    const p = filePersistence(relative(process.cwd(), dir), CLOCK);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);

    p.saveSketch('p1', 'm-1', png);

    const path = p.sketchPath('p1', 'm-1');
    expect(path).toBe(join(dir, 'sketches', 'p1', 'm-1.png'));
    expect(isAbsolute(path ?? '')).toBe(true);
    expect(readFileSync(path ?? '')).toEqual(Buffer.from(png));
    expect(readdirSync(join(dir, 'sketches', 'p1'))).toEqual(['m-1.png']);
    expect(p.sketchPath('p1', 'm-2')).toBeNull();
    expect(p.sketchPath('p2', 'm-1')).toBeNull();
    writeFileSync(join(dir, 'sketches', 'p3'), 'a file where the directory should be');
    expect(() => p.saveSketch('p3', 'm-1', png)).toThrow(PersistenceError);
    mkdirSync(join(dir, 'sketches', 'p4', 'm-1.png'), { recursive: true });
    expect(() => p.loadSketch('p4', 'm-1')).toThrow(PersistenceError);
  });

  it('a write failure throws PersistenceError with code IO', () => {
    writeFileSync(join(dir, 'plans'), 'a file where the directory should be');

    expect(() => filePersistence(dir, CLOCK).save('p1', sampleState())).toThrow(PersistenceError);
    try {
      filePersistence(dir, CLOCK).save('p1', sampleState());
    } catch (e) {
      expect((e as PersistenceError).code).toBe('IO');
    }
  });
});

describe('memoryPersistence', () => {
  it('stores copies, counts saves, and lists sorted ids', () => {
    const p = memoryPersistence();
    const state = sampleState();
    p.save('b', state);
    p.save('a', state);

    state.revision = 99;
    const loaded = p.load('a');
    expect(loaded?.revision).toBe(1);
    if (loaded) loaded.revision = 42;
    expect(p.load('a')?.revision).toBe(1);
    expect(p.load('missing')).toBeNull();
    expect(p.list()).toEqual(['a', 'b']);
    expect(p.saves).toBe(2);
  });
});
