import { describe, expect, it } from 'bun:test';
import { type ParsedArgs, parseArgs } from '../../src/cli/args';
import { CliError } from '../../src/cli/errors';

describe('parseArgs', () => {
  it.each<{ argv: string[]; expected: ParsedArgs }>([
    { argv: [], expected: { command: 'home', positionals: [], flags: {} } },
    { argv: ['--help'], expected: { command: 'home', positionals: [], flags: { help: true } } },
    { argv: ['help'], expected: { command: 'help', positionals: [], flags: {} } },
    { argv: ['open', 'plan.json'], expected: { command: 'open', positionals: ['plan.json'], flags: {} } },
    { argv: ['open', '-'], expected: { command: 'open', positionals: ['-'], flags: {} } },
    {
      argv: ['open', 'plan.json', '--no-open'],
      expected: { command: 'open', positionals: ['plan.json'], flags: { 'no-open': true } },
    },
    {
      argv: ['open', '--no-open', 'plan.json'],
      expected: { command: 'open', positionals: ['plan.json'], flags: { 'no-open': true } },
    },
    {
      argv: ['patch-block', 'p-1', 'b-1', '--file', '-'],
      expected: { command: 'patch-block', positionals: ['p-1', 'b-1'], flags: { file: '-' } },
    },
    {
      argv: ['poll', 'p-1', '--timeout-ms', '0'],
      expected: { command: 'poll', positionals: ['p-1'], flags: { 'timeout-ms': '0' } },
    },
    {
      argv: ['poll', 'p-1', '--timeout-ms=250'],
      expected: { command: 'poll', positionals: ['p-1'], flags: { 'timeout-ms': '250' } },
    },
    {
      argv: ['answer', 'p-1', '--question', 'm-1', '--text=a = b'],
      expected: { command: 'answer', positionals: ['p-1'], flags: { question: 'm-1', text: 'a = b' } },
    },
    {
      argv: ['ack', 'p-1', 'm-1', 'm-2'],
      expected: { command: 'ack', positionals: ['p-1', 'm-1', 'm-2'], flags: {} },
    },
    { argv: ['skill', '--check'], expected: { command: 'skill', positionals: [], flags: { check: true } } },
    { argv: ['skill', '--install'], expected: { command: 'skill', positionals: [], flags: { install: true } } },
    {
      argv: ['answer', 'p-1', '--text', '-x', '--', '--file'],
      expected: { command: 'answer', positionals: ['p-1', '--file'], flags: { text: '-x' } },
    },
  ])('argv table: $argv', ({ argv, expected }) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  it('a value flag at the end with no value is BAD_ARGS', () => {
    for (const argv of [
      ['poll', 'p-1', '--timeout-ms'],
      ['open', '--file', '--no-open'],
    ]) {
      let caught: unknown;
      try {
        parseArgs(argv);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).code).toBe('BAD_ARGS');
    }
  });
});
