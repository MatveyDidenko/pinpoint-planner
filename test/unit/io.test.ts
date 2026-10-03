import { describe, expect, it } from 'bun:test';
import { CliError } from '../../src/cli/errors';
import { configFrom } from '../../src/cli/io';

describe('configFrom', () => {
  it('configFrom returns the documented defaults', () => {
    expect(configFrom({ HOME: '/home/tester' })).toEqual({
      port: 4777,
      baseUrl: 'http://127.0.0.1:4777',
      stateDir: '/home/tester/.pinpoint',
      noOpen: false,
      idleTimeoutMs: 1800000,
      pollMaxWaitMs: 1500000,
      browserGraceMs: 90000,
    });
  });

  it('every PINPOINT_* env var overrides its default and a non-numeric port is BAD_ARGS', () => {
    expect(
      configFrom({
        HOME: '/home/tester',
        PINPOINT_PORT: '4790',
        PINPOINT_STATE_DIR: '/tmp/state',
        PINPOINT_NO_OPEN: '1',
        PINPOINT_IDLE_TIMEOUT_MS: '5',
        PINPOINT_POLL_MAX_WAIT_MS: '0',
        PINPOINT_BROWSER_GRACE_MS: '7',
      }),
    ).toEqual({
      port: 4790,
      baseUrl: 'http://127.0.0.1:4790',
      stateDir: '/tmp/state',
      noOpen: true,
      idleTimeoutMs: 5,
      pollMaxWaitMs: 0,
      browserGraceMs: 7,
    });
    expect(configFrom({ HOME: '/h', PINPOINT_NO_OPEN: '0' }).noOpen).toBe(false);

    for (const bad of ['abc', '', '1.5', '-1', '0', '65536']) {
      const attempt = () => configFrom({ HOME: '/h', PINPOINT_PORT: bad });
      expect(attempt).toThrow(CliError);
      try {
        attempt();
      } catch (error) {
        expect((error as CliError).code).toBe('BAD_ARGS');
        expect((error as CliError).message).toContain('PINPOINT_PORT');
      }
    }
    expect(() => configFrom({ HOME: '/h', PINPOINT_IDLE_TIMEOUT_MS: 'soon' })).toThrow(/PINPOINT_IDLE_TIMEOUT_MS/);
  });
});
