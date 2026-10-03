export class KeyedTimer {
  readonly #ms: number;
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(ms: number) {
    this.#ms = ms;
  }

  arm(key: string, fn: () => void): void {
    this.cancel(key);
    const timer = setTimeout(() => {
      this.#timers.delete(key);
      fn();
    }, this.#ms);
    timer.unref();
    this.#timers.set(key, timer);
  }

  cancel(key: string): void {
    clearTimeout(this.#timers.get(key));
    this.#timers.delete(key);
  }

  armed(key: string): boolean {
    return this.#timers.has(key);
  }

  close(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}

export class IdleWatch {
  readonly #idleMs: number;
  readonly #isBusy: () => boolean;
  readonly #onIdle: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #done = false;

  constructor({ idleMs, isBusy, onIdle }: { idleMs: number; isBusy: () => boolean; onIdle: () => void }) {
    this.#idleMs = idleMs;
    this.#isBusy = isBusy;
    this.#onIdle = onIdle;
    this.#arm();
  }

  poke(): void {
    if (!this.#done) this.#arm();
  }

  close(): void {
    this.#done = true;
    clearTimeout(this.#timer);
  }

  #arm(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (this.#isBusy()) {
        this.#arm();
        return;
      }
      this.#done = true;
      this.#onIdle();
    }, this.#idleMs);
    this.#timer.unref();
  }
}
