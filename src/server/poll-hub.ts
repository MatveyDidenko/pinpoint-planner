import { openStream } from './stream';

export type PollWhy = 'message' | 'browser_closed' | 'timeout';

interface Waiter {
  wake(why: PollWhy): void;
  close(): void;
}

export class PollHub {
  readonly #heartbeatMs: number;
  readonly #onChange: (() => void) | undefined;
  readonly #waiters = new Map<string, Set<Waiter>>();

  constructor(options: { heartbeatMs: number; onChange?: () => void }) {
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
    for (const waiter of [...(this.#waiters.get(planId) ?? [])]) waiter.wake(reason);
  }

  listen(planId: string, timeoutMs: number, signal: AbortSignal, finish: (why: PollWhy) => unknown): Response {
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
      this.#onChange?.();
      return true;
    };

    const waiter: Waiter = {
      wake: (why) => {
        if (!release()) return;
        void settle(why);
      },
      close: () => {
        release();
        stream.end();
      },
    };

    const settle = async (why: PollWhy): Promise<void> => {
      try {
        stream.end(JSON.stringify(await finish(why)));
      } catch {
        stream.end();
      }
    };

    const set = this.#waiters.get(planId) ?? new Set<Waiter>();
    set.add(waiter);
    this.#waiters.set(planId, set);
    this.#onChange?.();
    stream.onClose(release);
    return stream.response;
  }

  close(): void {
    for (const set of [...this.#waiters.values()]) for (const waiter of [...set]) waiter.close();
  }
}
