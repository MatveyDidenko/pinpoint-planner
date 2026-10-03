import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanState } from '../core/types';

export interface Persistence {
  load(id: string): PlanState | null;
  save(id: string, state: PlanState): void;
  list(): string[];
}

export class PersistenceError extends Error {
  readonly code = 'IO';

  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

export function memoryPersistence(): Persistence & { saves: number } {
  const plans = new Map<string, PlanState>();
  return {
    saves: 0,
    load(id) {
      const stored = plans.get(id);
      return stored ? structuredClone(stored) : null;
    },
    save(id, state) {
      this.saves += 1;
      plans.set(id, structuredClone(state));
    },
    list: () => [...plans.keys()].sort(),
  };
}

function isCurrentState(value: unknown): value is PlanState {
  return typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 1;
}

/** Writes each plan to `<dir>/plans/<id>.json` atomically; `clock` only stamps quarantined corrupt files. */
export function filePersistence(dir: string, clock: () => Date): Persistence {
  const plansDir = join(dir, 'plans');
  const fileFor = (id: string) => join(plansDir, `${id}.json`);

  return {
    load(id) {
      const file = fileFor(id);
      if (!existsSync(file)) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        const stamp = clock().toISOString().replaceAll(':', '-');
        try {
          renameSync(file, `${file}.corrupt-${stamp}`);
        } catch (e) {
          throw new PersistenceError(`could not quarantine corrupt plan file ${file}: ${(e as Error).message}`);
        }
        return null;
      }
      return isCurrentState(parsed) ? parsed : null;
    },
    save(id, state) {
      const file = fileFor(id);
      const tmp = `${file}.tmp`;
      try {
        mkdirSync(plansDir, { recursive: true });
        writeFileSync(tmp, JSON.stringify(state));
        renameSync(tmp, file);
      } catch (e) {
        throw new PersistenceError(`could not save plan ${id}: ${(e as Error).message}`);
      }
    },
    list() {
      if (!existsSync(plansDir)) return [];
      return readdirSync(plansDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort();
    },
  };
}
