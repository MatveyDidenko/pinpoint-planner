import { describe, expect, it } from 'bun:test';
import { readBody, readJsonBody } from '../../src/cli/body';
import { CliError } from '../../src/cli/errors';
import { parsePlanInput } from '../../src/core/schema';
import { fakeIo } from '../helpers/fake-io';

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected the promise to reject');
}

describe('readBody', () => {
  it('--file - reads stdin and --file reads the path', async () => {
    const io = fakeIo({
      readStdin: async () => 'line one\nline two\n',
      readFile: async (p) => `contents of ${p}`,
    });

    expect(await readBody(io, { file: '-' })).toBe('line one\nline two\n');
    expect(await readBody(io, { file: 'answer.md' })).toBe('contents of answer.md');
    expect(await readBody(io, { text: 'one-liner' })).toBe('one-liner');
  });

  it('invalid json yields INVALID_INPUT with an issue path and no source is BAD_ARGS', async () => {
    const io = fakeIo({
      readStdin: async () => '{ not json',
      readFile: async () => {
        throw new Error('ENOENT');
      },
    });

    const none = await failure(readBody(io, {}));
    expect(none.code).toBe('BAD_ARGS');
    expect(none.message).toContain('--text');

    const both = await failure(readBody(io, { text: 'a', file: 'b' }));
    expect(both.code).toBe('BAD_ARGS');

    const missing = await failure(readBody(io, { file: 'nope.md' }));
    expect(missing.code).toBe('BAD_ARGS');
    expect(missing.message).toContain('nope.md');

    const flagWithoutValue = await failure(readBody(io, { text: true }));
    expect(flagWithoutValue.code).toBe('BAD_ARGS');

    const badJson = await failure(readJsonBody(io, { file: '-' }, parsePlanInput));
    expect(badJson.code).toBe('INVALID_INPUT');
    expect(badJson.message).toBe('body is not valid JSON');
    expect(badJson.issues).toHaveLength(1);
    expect(badJson.issues?.[0]?.path).toBe('');
    expect(badJson.issues?.[0]?.message.length).toBeGreaterThan(0);

    const badSchema = await failure(
      readJsonBody(fakeIo({ readStdin: async () => '{}' }), { file: '-' }, parsePlanInput),
    );
    expect(badSchema.code).toBe('INVALID_INPUT');
    expect(badSchema.issues?.length).toBeGreaterThan(0);
    expect(badSchema.issues?.some((issue) => issue.path !== '')).toBe(true);

    const noSource = await failure(readJsonBody(io, {}, parsePlanInput));
    expect(noSource.code).toBe('BAD_ARGS');
  });
});

describe('readJsonBody', () => {
  it('returns the parsed value when the body is valid', async () => {
    const parse = (raw: unknown) => ({ ok: true as const, value: raw as { n: number } });
    expect(await readJsonBody(fakeIo(), { text: '{"n":3}' }, parse)).toEqual({ n: 3 });
  });
});
