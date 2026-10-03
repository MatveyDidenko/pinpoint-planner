import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from './io';

const ENTRY = resolve(import.meta.dir, '../../bin/pinpoint.ts');

export function buildSpawnArgs(
  o: Config,
  env: Record<string, string | undefined> = process.env,
  execPath: string = process.execPath,
): { cmd: string; args: string[]; env: Record<string, string | undefined> } {
  return {
    cmd: execPath,
    args: [ENTRY, 'serve', '--port', String(o.port), '--state-dir', o.stateDir, '--idle-ms', String(o.idleTimeoutMs)],
    env: {
      ...env,
      PINPOINT_NO_OPEN: '1',
      PINPOINT_POLL_MAX_WAIT_MS: String(o.pollMaxWaitMs),
      PINPOINT_BROWSER_GRACE_MS: String(o.browserGraceMs),
    },
  };
}

export function spawnDaemon(o: Config): void {
  const { cmd, args, env } = buildSpawnArgs(o);
  mkdirSync(o.stateDir, { recursive: true });
  const fd = openSync(join(o.stateDir, 'helper.log'), 'a');
  try {
    spawn(cmd, args, { detached: true, stdio: ['ignore', fd, fd], env }).unref();
  } finally {
    closeSync(fd);
  }
}
