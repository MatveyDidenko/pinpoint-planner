import { openStream } from './stream';

export type PollWhy = 'message' | 'browser_closed' | 'timeout';

export interface PollFinishInfo {
  woken: number;
}

interface Waiter {
  wake(why: PollWhy, woken?: number): void;
  close(): void;
}

export class PollHub {
  readonly #heartbeatMs: number;
  readonly #onChange: ((planId: string) => void) | undefined;
  readonly #waiters = new Map<string, Set<Waiter>>();

  constructor(options: { heartbeatMs: number; onChange?: (planId: string) => void }) {
    this.#heartbeatMs = options.heartbeatMs;
    this.#onChange = options.onChange;
  }

  waiters(planId: string): number {
    return this.#waiters.get(planId)?.size ?? 0;
  }

  total(): number {
    let sum = 0;
    for (const set of this.#waiters.values()) sum += set.size;
    return sum;
  }

  wake(planId: string, reason: 'message' | 'browser_closed'): void {
    const waiting = [...(this.#waiters.get(planId) ?? [])];
    for (const waiter of waiting) waiter.wake(reason, waiting.length);
  }

  /** `finish` receives how many pollers were woken together, itself included. */
  listen(
    planId: string,
    timeoutMs: number,
    signal: AbortSignal,
    finish: (why: PollWhy, info: PollFinishInfo) => unknown,
  ): Response {
    const stream = openStream(
      signal,
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Pinpoint-Poll-State': 'listening',
      },
      { heartbeatMs: this.#heartbeatMs, heartbeat: ' ' },
    );
    let released = false;
    const timer = setTimeout(() => waiter.wake('timeout'), timeoutMs);
    timer.unref();

    const release = (): boolean => {
      if (released) return false;
      released = true;
      clearTimeout(timer);
      const set = this.#waiters.get(planId);
      set?.delete(waiter);
      if (set?.size === 0) this.#waiters.delete(planId);
      this.#onChange?.(planId);
      return true;
    };

    const waiter: Waiter = {
      wake: (why, woken = 1) => {
        if (!release()) return;
        void settle(why, { woken });
      },
      close: () => {
        release();
        stream.end();
      },
    };

    const settle = async (why: PollWhy, info: PollFinishInfo): Promise<void> => {
      try {
        stream.end(JSON.stringify(await finish(why, info)));
      } catch {
        stream.end();
      }
    };

    const set = this.#waiters.get(planId) ?? new Set<Waiter>();
    set.add(waiter);
    this.#waiters.set(planId, set);
    this.#onChange?.(planId);
    stream.onClose(release);
    return stream.response;
  }

  close(): void {
    for (const set of [...this.#waiters.values()]) for (const waiter of [...set]) waiter.close();
  }
}
