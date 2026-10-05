import { describe, expect, it } from 'bun:test';
import type { spawn } from 'node:child_process';
import { CliError } from '../../src/cli/errors';
import { openBrowser, openCommandFor } from '../../src/cli/open-browser';

describe('openCommandFor', () => {
  it('openCommandFor per platform', () => {
    const url = 'http://127.0.0.1:4777/p/abc';
    expect(openCommandFor('darwin', url)).toEqual(['open', url]);
    expect(openCommandFor('linux', url)).toEqual(['xdg-open', url]);
    expect(openCommandFor('win32', url)).toEqual(['cmd', '/c', 'start', '""', url]);
  });

  it('an unknown platform throws BAD_ARGS', () => {
    let caught: unknown;
    try {
      openCommandFor('freebsd', 'http://127.0.0.1:4777/p/abc');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).code).toBe('BAD_ARGS');
  });
});

describe('openBrowser', () => {
  function recordingSpawn() {
    const calls: { command: string; args: readonly string[]; options: unknown }[] = [];
    let unrefCalls = 0;
    const fake = ((command: string, args: readonly string[], options: unknown) => {
      calls.push({ command, args, options });
      return {
        unref: () => {
          unrefCalls += 1;
        },
      };
    }) as unknown as typeof spawn;
    return { fake, calls, unrefCalls: () => unrefCalls };
  }

  it('spawns the platform command detached with ignored stdio and unrefs the child', () => {
    const url = 'http://127.0.0.1:4777/p/abc';
    const spy = recordingSpawn();
    openBrowser(url, 'darwin', spy.fake);
    expect(spy.calls).toEqual([{ command: 'open', args: [url], options: { detached: true, stdio: 'ignore' } }]);
    expect(spy.unrefCalls()).toBe(1);
  });

  it('an unknown platform throws before anything is spawned', () => {
    const spy = recordingSpawn();
    expect(() => openBrowser('http://127.0.0.1:4777/p/abc', 'freebsd', spy.fake)).toThrow(CliError);
    expect(spy.calls).toEqual([]);
  });
});
