import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { buildSpawnArgs } from '../../src/cli/daemon';
import { configFrom } from '../../src/cli/io';

describe('buildSpawnArgs', () => {
  it('buildSpawnArgs uses execPath, the absolute entry and PINPOINT_NO_OPEN=1', () => {
    const cfg = configFrom({ HOME: '/home/tester' });
    const spawn = buildSpawnArgs(cfg, { PATH: '/usr/bin' }, '/opt/bun');

    expect(spawn.cmd).toBe('/opt/bun');
    const [entry, ...rest] = spawn.args;
    expect(isAbsolute(entry ?? '')).toBe(true);
    expect(entry?.endsWith('/bin/pinpoint.ts')).toBe(true);
    expect(existsSync(entry ?? '')).toBe(true);
    expect(rest).toEqual(['serve', '--port', '4777', '--state-dir', '/home/tester/.pinpoint', '--idle-ms', '1800000']);
    expect(spawn.env).toEqual({
      PATH: '/usr/bin',
      PINPOINT_NO_OPEN: '1',
      PINPOINT_POLL_MAX_WAIT_MS: '1500000',
      PINPOINT_BROWSER_GRACE_MS: '90000',
    });
  });

  it('buildSpawnArgs passes the configured idle timeout and state dir verbatim', () => {
    const cfg = configFrom({
      HOME: '/h',
      PINPOINT_PORT: '4790',
      PINPOINT_STATE_DIR: '/tmp/odd dir/state',
      PINPOINT_IDLE_TIMEOUT_MS: '3000',
      PINPOINT_POLL_MAX_WAIT_MS: '11',
      PINPOINT_BROWSER_GRACE_MS: '0',
    });
    const spawn = buildSpawnArgs(cfg, { PINPOINT_NO_OPEN: '0' }, '/opt/bun');

    expect(spawn.args.slice(1)).toEqual([
      'serve',
      '--port',
      '4790',
      '--state-dir',
      '/tmp/odd dir/state',
      '--idle-ms',
      '3000',
    ]);
    expect(spawn.env.PINPOINT_NO_OPEN).toBe('1');
    expect(spawn.env.PINPOINT_POLL_MAX_WAIT_MS).toBe('11');
    expect(spawn.env.PINPOINT_BROWSER_GRACE_MS).toBe('0');
  });
});
