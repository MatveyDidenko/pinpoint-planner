import type { CliIo } from '../../src/cli/io';

type FetchImpl = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;

export const asFetch = (impl: FetchImpl): typeof fetch => Object.assign(impl, { preconnect: () => {} });

function unused(name: string) {
  return () => {
    throw new Error(`fakeIo: ${name} was not provided`);
  };
}

export function fakeIo(over: Partial<CliIo> = {}): CliIo {
  return {
    fetch: unused('fetch') as unknown as typeof fetch,
    env: {},
    cwd: '/work',
    stdout: unused('stdout'),
    stderr: unused('stderr'),
    readFile: unused('readFile'),
    readStdin: unused('readStdin'),
    writeFile: unused('writeFile'),
    spawnDaemon: unused('spawnDaemon'),
    openBrowser: unused('openBrowser'),
    sleep: unused('sleep'),
    now: () => new Date('2026-10-03T18:00:00.000Z'),
    isTTY: false,
    argv1: '/repo/bin/pinpoint.ts',
    execPath: '/usr/bin/bun',
    ...over,
  };
}
