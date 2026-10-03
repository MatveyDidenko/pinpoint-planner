import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserMessage } from '../../src/core/schema';
import { type AppDeps, createApp, type PinpointApp } from '../../src/server/app';
import { STUB_ASSETS } from '../../src/server/assets';
import { memoryPersistence } from '../../src/server/persistence';
import { PlanStore } from '../../src/server/store';

export const TEST_BASE_URL = 'http://127.0.0.1:4777';

const FIXED_START_MS = Date.parse('2026-10-03T18:00:00.000Z');
const ONE_SECOND_MS = 1000;
const WAIT_DEADLINE_MS = 1000;
const FRAME_GUARD_MS = 2000;

export function fixedClock(): () => Date {
  let calls = 0;
  return () => new Date(FIXED_START_MS + ONE_SECOND_MS * calls++);
}

export type TestApp = PinpointApp & {
  persistence: ReturnType<typeof memoryPersistence>;
  clock: () => Date;
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
};

export function makeTestApp(over: Partial<AppDeps> = {}): TestApp {
  const persistence = memoryPersistence();
  const clock = over.clock ?? fixedClock();
  const store = over.store ?? new PlanStore(persistence, clock);
  const pinpoint = createApp({
    store,
    assets: STUB_ASSETS,
    baseUrl: TEST_BASE_URL,
    version: '0.0.0-test',
    startedAt: '2026-10-03T17:59:00.000Z',
    clock,
    heartbeatMs: 5,
    pollMaxWaitMs: 2000,
    browserGraceMs: 30,
    ...over,
  });
  return {
    ...pinpoint,
    persistence,
    clock,
    request: (path, init) => pinpoint.app.request(new URL(path, 'http://localhost').toString(), init),
  };
}

export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', `${name}.json`), 'utf8'));
}

export async function seedPlan(t: TestApp, id = 'auth-refresh') {
  const res = await t.request(`/api/plans/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fixture('plan.auth-refresh'), id }),
  });
  if (!res.ok) throw new Error(`seedPlan ${id} failed with ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function waitFor(pred: () => boolean | Promise<boolean>, label?: string): Promise<void> {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await Bun.sleep(1);
  }
  throw new Error(`waitFor timed out: ${label ?? pred.toString()}`);
}

export interface ParsedFrame {
  event: string;
  data: unknown;
}

interface FrameReader {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  buffer: string;
}

const frameReaders = new WeakMap<Response, FrameReader>();

function parseFrame(raw: string): ParsedFrame | null {
  const event = /^event: (.*)$/m.exec(raw)?.[1];
  const data = /^data: (.*)$/m.exec(raw)?.[1];
  if (event === undefined || data === undefined) return null;
  return { event, data: JSON.parse(data) };
}

export async function readFrames(res: Response, n: number): Promise<ParsedFrame[]> {
  if (res.body === null) throw new Error('response has no body');
  let state = frameReaders.get(res);
  if (state === undefined) {
    state = { reader: res.body.getReader(), buffer: '' };
    frameReaders.set(res, state);
  }
  const { reader } = state;
  const decoder = new TextDecoder();
  const frames: ParsedFrame[] = [];

  const collect = async (): Promise<ParsedFrame[]> => {
    while (frames.length < n) {
      const end = state.buffer.indexOf('\n\n');
      if (end === -1) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`stream ended after ${frames.length} of ${n} frames`);
        state.buffer += decoder.decode(chunk.value, { stream: true });
        continue;
      }
      const raw = state.buffer.slice(0, end);
      state.buffer = state.buffer.slice(end + 2);
      const frame = parseFrame(raw);
      if (frame !== null) frames.push(frame);
    }
    return frames;
  };

  let guard: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    guard = setTimeout(
      () => reject(new Error(`readFrames: ${frames.length} of ${n} frames in ${FRAME_GUARD_MS}ms`)),
      FRAME_GUARD_MS,
    );
  });
  try {
    return await Promise.race([collect(), timedOut]);
  } finally {
    clearTimeout(guard);
  }
}

export async function blockHtml(t: TestApp, planId: string, blockId: string): Promise<string> {
  const res = await t.request(`/api/plans/${planId}/blocks/${blockId}.html`);
  return res.text();
}

let clientCounter = 0;

export function ask(blockId: string, text: string, clientId?: string): BrowserMessage {
  clientCounter += 1;
  return { clientId: clientId ?? `client-${String(clientCounter).padStart(4, '0')}`, kind: 'ask', blockId, text };
}
