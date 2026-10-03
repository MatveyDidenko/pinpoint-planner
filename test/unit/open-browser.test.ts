import { describe, expect, it } from 'bun:test';
import { CliError } from '../../src/cli/errors';
import { openCommandFor } from '../../src/cli/open-browser';

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
