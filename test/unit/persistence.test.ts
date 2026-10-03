import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlanInput } from '../../src/core/schema';
import { openPlan } from '../../src/core/state';
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
