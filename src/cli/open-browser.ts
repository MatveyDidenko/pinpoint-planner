import { spawn } from 'node:child_process';
import { CliError } from './errors';

export function openCommandFor(platform: NodeJS.Platform, url: string): [string, ...string[]] {
  switch (platform) {
    case 'darwin':
      return ['open', url];
    case 'linux':
      return ['xdg-open', url];
    case 'win32':
      return ['cmd', '/c', 'start', '""', url];
    default:
      throw new CliError('BAD_ARGS', `cannot open a browser on platform "${platform}"; open ${url} manually`);
  }
}

export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawnFn: typeof spawn = spawn,
): void {
  const [command, ...args] = openCommandFor(platform, url);
  spawnFn(command, args, { detached: true, stdio: 'ignore' }).unref();
}
