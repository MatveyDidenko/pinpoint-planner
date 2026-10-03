import { afterEach, describe, expect, it } from 'bun:test';
import { IdleWatch, KeyedTimer } from '../../src/server/timers';

const MS = 10;
const timers: KeyedTimer[] = [];
const watches: IdleWatch[] = [];

function makeTimer(): KeyedTimer {
  const timer = new KeyedTimer(MS);
  timers.push(timer);
  return timer;
}

function makeWatch(options: ConstructorParameters<typeof IdleWatch>[0]): IdleWatch {
  const watch = new IdleWatch(options);
  watches.push(watch);
  return watch;
}

function firesOnce(): { fn: () => void; fired: Promise<number>; count: () => number } {
  let count = 0;
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const deadline = setTimeout(() => reject(new Error('timer did not fire within 2000ms')), 2000);
  const fn = () => {
    count += 1;
    clearTimeout(deadline);
    resolve(performance.now());
  };
  return { fn, fired: promise, count: () => count };
}

function spinFor(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // busy-wait keeps the event loop blocked past the pending deadline
  }
}

afterEach(() => {
  for (const timer of timers) timer.close();
  timers.length = 0;
  for (const watch of watches) watch.close();
  watches.length = 0;
});

describe('KeyedTimer', () => {
  it('KeyedTimer fires once per key and cancel prevents firing', async () => {
    const timer = makeTimer();
    const a = firesOnce();
    let cancelledFired = 0;

    timer.arm('a', a.fn);
    timer.arm('b', () => {
      cancelledFired += 1;
    });
    expect(timer.armed('a')).toBe(true);
    expect(timer.armed('b')).toBe(true);
    expect(timer.armed('c')).toBe(false);

    timer.cancel('b');
    expect(timer.armed('b')).toBe(false);

    await a.fired;
    expect(timer.armed('a')).toBe(false);

    await Bun.sleep(MS * 3);
    expect(a.count()).toBe(1);
    expect(cancelledFired).toBe(0);
  });

  it('re-arming a key resets its deadline and close prevents a pending fire', async () => {
    const timer = makeTimer();
    const rearmed = firesOnce();

    timer.arm('k', () => {
      throw new Error('replaced callback must not run');
    });
    spinFor(MS + 5);
    const secondArmAt = performance.now();
    timer.arm('k', rearmed.fn);

    const firedAt = await rearmed.fired;
    expect(firedAt - secondArmAt).toBeGreaterThanOrEqual(MS - 2);
    expect(rearmed.count()).toBe(1);

    let closedFired = 0;
    timer.arm('x', () => {
      closedFired += 1;
    });
    timer.arm('y', () => {
      closedFired += 1;
    });
    timer.close();
    expect(timer.armed('x')).toBe(false);
    expect(timer.armed('y')).toBe(false);

    await Bun.sleep(MS * 3);
    expect(closedFired).toBe(0);
  });
});

describe('IdleWatch', () => {
  it('IdleWatch fires after idleMs with nothing busy', async () => {
    const idle = firesOnce();
    const armedAt = performance.now();
    makeWatch({ idleMs: MS, isBusy: () => false, onIdle: idle.fn });

    const firedAt = await idle.fired;
    expect(firedAt - armedAt).toBeGreaterThanOrEqual(MS - 2);

    await Bun.sleep(MS * 3);
    expect(idle.count()).toBe(1);
  });

  it('IdleWatch does not fire while busy and fires after busy clears', async () => {
    const idle = firesOnce();
    let busy = true;
    makeWatch({ idleMs: MS, isBusy: () => busy, onIdle: idle.fn });

    await Bun.sleep(MS * 3);
    expect(idle.count()).toBe(0);

    busy = false;
    await idle.fired;
    expect(idle.count()).toBe(1);
  });

  it('poke pushes the deadline out, close prevents firing, and poke after firing does nothing', async () => {
    const pushed = firesOnce();
    const watch = makeWatch({ idleMs: MS, isBusy: () => false, onIdle: pushed.fn });
    spinFor(MS + 5);
    const pokedAt = performance.now();
    watch.poke();

    const firedAt = await pushed.fired;
    expect(firedAt - pokedAt).toBeGreaterThanOrEqual(MS - 2);

    watch.poke();
    await Bun.sleep(MS * 3);
    expect(pushed.count()).toBe(1);

    let closedFired = 0;
    const closed = makeWatch({
      idleMs: MS,
      isBusy: () => false,
      onIdle: () => {
        closedFired += 1;
      },
    });
    closed.close();
    await Bun.sleep(MS * 3);
    expect(closedFired).toBe(0);
  });
});
