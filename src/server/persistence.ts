import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PlanState } from '../core/types';

export interface Persistence {
  load(id: string): PlanState | null;
  save(id: string, state: PlanState): void;
  list(): string[];
  saveSketch(planId: string, messageId: string, png: Uint8Array<ArrayBuffer>): void;
  sketchPath(planId: string, messageId: string): string | null;
  loadSketch(planId: string, messageId: string): Uint8Array<ArrayBuffer> | null;
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
  const sketches = new Map<string, Uint8Array<ArrayBuffer>>();
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
    saveSketch(planId, messageId, png) {
      sketches.set(`${planId}/${messageId}`, png);
    },
    sketchPath: () => null,
    loadSketch: (planId, messageId) => sketches.get(`${planId}/${messageId}`) ?? null,
  };
}

function isCurrentState(value: unknown): value is PlanState {
  return typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 1;
}

// Plans saved before threads existed have exchanges and asks without a threadId.
function withThreadIds(state: PlanState): PlanState {
  return {
    ...state,
    plan: {
      ...state.plan,
      blocks: state.plan.blocks.map((block) => ({
        ...block,
        qa: block.qa.map((exchange) => ({ ...exchange, threadId: exchange.threadId ?? exchange.id })),
      })),
    },
    messages: state.messages.map((message) =>
      message.kind === 'ask' ? { ...message, threadId: message.threadId ?? message.id } : message,
    ),
  };
}

function writeAtomically(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** Writes each plan to `<dir>/plans/<id>.json` and each sketch to `<dir>/sketches/<plan>/<message>.png` atomically; `clock` only stamps quarantined corrupt files. */
export function filePersistence(dir: string, clock: () => Date): Persistence {
  const plansDir = join(dir, 'plans');
  const fileFor = (id: string) => join(plansDir, `${id}.json`);
  const sketchFile = (planId: string, messageId: string) => resolve(dir, 'sketches', planId, `${messageId}.png`);
  const existingSketch = (planId: string, messageId: string) => {
    const file = sketchFile(planId, messageId);
    return existsSync(file) ? file : null;
  };

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
      return isCurrentState(parsed) ? withThreadIds(parsed) : null;
    },
    save(id, state) {
      try {
        writeAtomically(fileFor(id), JSON.stringify(state));
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
    saveSketch(planId, messageId, png) {
      try {
        writeAtomically(sketchFile(planId, messageId), png);
      } catch (e) {
        throw new PersistenceError(`could not save sketch ${messageId} of plan ${planId}: ${(e as Error).message}`);
      }
    },
    sketchPath: existingSketch,
    loadSketch(planId, messageId) {
      const file = existingSketch(planId, messageId);
      return file === null ? null : readFileSync(file);
    },
  };
}
