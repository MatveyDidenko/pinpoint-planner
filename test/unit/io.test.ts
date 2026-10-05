import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliError } from '../../src/cli/errors';
import { configFrom, realIo } from '../../src/cli/io';

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

describe('realIo', () => {
  it('writeFile creates missing parent directories and readFile reads the text back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pinpoint-io-'));
    try {
      const io = realIo();
      const path = join(dir, 'a', 'b', 'note.txt');
      await io.writeFile(path, 'héllo');
      expect(await io.readFile(path)).toBe('héllo');
      expect(await readFile(path, 'utf8')).toBe('héllo');
      await expect(io.readFile(join(dir, 'missing.txt'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sleep resolves, now returns a Date and the process facts have the right types', async () => {
    const io = realIo();
    await expect(io.sleep(1)).resolves.toBeUndefined();
    expect(io.now()).toBeInstanceOf(Date);
    expect(io.stdout('')).toBeUndefined();
    expect(io.stderr('')).toBeUndefined();
    expect(typeof io.isTTY).toBe('boolean');
    expect(typeof io.argv1).toBe('string');
    expect(io.execPath).toBe(process.execPath);
    expect(io.cwd).toBe(process.cwd());
    expect(io.env).toBe(process.env);
  });

  it('readStdin reads all of standard input as text', async () => {
    const text = spyOn(Bun.stdin, 'text').mockResolvedValue('{"a":1}');
    try {
      expect(await realIo().readStdin()).toBe('{"a":1}');
    } finally {
      text.mockRestore();
    }
  });
});
