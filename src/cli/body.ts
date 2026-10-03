import type { Result } from '../core/schema';
import type { ParsedArgs } from './args';
import { CliError } from './errors';
import type { CliIo } from './io';

const SOURCE_HINT = 'pass --text "<one line>", --file <path>, or --file - to read stdin';

export async function readBody(io: CliIo, flags: ParsedArgs['flags']): Promise<string> {
  const { text, file } = flags;
  if (text !== undefined && file !== undefined) {
    throw new CliError('BAD_ARGS', `--text and --file are mutually exclusive; ${SOURCE_HINT}.`);
  }
  if (text !== undefined) {
    if (text === true) throw new CliError('BAD_ARGS', `--text needs a value; ${SOURCE_HINT}.`);
    return text;
  }
  if (file === undefined) throw new CliError('BAD_ARGS', `no body given; ${SOURCE_HINT}.`);
  if (file === true) throw new CliError('BAD_ARGS', `--file needs a path or -; ${SOURCE_HINT}.`);
  if (file === '-') return io.readStdin();
  try {
    return await io.readFile(file);
  } catch {
    throw new CliError('BAD_ARGS', `cannot read --file ${file}; check the path exists and is readable.`);
  }
}

export async function readJsonBody<T>(
  io: CliIo,
  flags: ParsedArgs['flags'],
  parse: (raw: unknown) => Result<T>,
): Promise<T> {
  const body = await readBody(io, flags);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('INVALID_INPUT', 'body is not valid JSON', [{ path: '', message }]);
  }
  const result = parse(raw);
  if (!result.ok) throw new CliError('INVALID_INPUT', 'body does not match the expected shape', result.issues);
  return result.value;
}
