import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnDaemon } from './daemon';
import { CliError } from './errors';
import { openBrowser } from './open-browser';

export type Config = ReturnType<typeof configFrom>;

export interface CliIo {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  cwd: string;
  stdout(s: string): void;
  stderr(s: string): void;
  readFile(p: string): Promise<string>;
  readStdin(): Promise<string>;
  writeFile(p: string, s: string): Promise<void>;
  spawnDaemon(o: Config): void | Promise<void>;
  openBrowser(url: string): void | Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): Date;
  isTTY: boolean;
  argv1: string;
  execPath: string;
}

function intFrom(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CliError('BAD_ARGS', `${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

export function configFrom(env: Record<string, string | undefined>) {
  const port = intFrom(env, 'PINPOINT_PORT', 4777, 1, 65535);
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    stateDir: env.PINPOINT_STATE_DIR ?? join(env.HOME ?? homedir(), '.pinpoint'),
    noOpen: env.PINPOINT_NO_OPEN === '1',
    idleTimeoutMs: intFrom(env, 'PINPOINT_IDLE_TIMEOUT_MS', 1800000, 0, Number.MAX_SAFE_INTEGER),
    pollMaxWaitMs: intFrom(env, 'PINPOINT_POLL_MAX_WAIT_MS', 1500000, 0, Number.MAX_SAFE_INTEGER),
    browserGraceMs: intFrom(env, 'PINPOINT_BROWSER_GRACE_MS', 90000, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function realIo(): CliIo {
  return {
    fetch,
    env: process.env,
    cwd: process.cwd(),
    stdout: (s) => {
      process.stdout.write(s);
    },
    stderr: (s) => {
      process.stderr.write(s);
    },
    readFile: (p) => readFile(p, 'utf8'),
    readStdin: () => Bun.stdin.text(),
    writeFile: async (p, s) => {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, s);
    },
    spawnDaemon: (o) => {
      spawnDaemon(o);
    },
    openBrowser,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    isTTY: process.stdout.isTTY === true,
    argv1: process.argv[1] ?? '',
    execPath: process.execPath,
  };
}
