import { CliError } from './errors';

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | true>;
}

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['no-open', 'check', 'install', 'help']);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;

    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (BOOLEAN_FLAGS.has(body)) {
      flags[body] = true;
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new CliError('BAD_ARGS', `--${body} needs a value; pass it as --${body} <value> or --${body}=<value>.`);
      }
      flags[body] = value;
      i++;
    }
  }

  return { command: positionals.shift() ?? 'home', positionals, flags };
}
