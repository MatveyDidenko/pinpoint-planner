import { describe, expect, it } from 'bun:test';
import { COMMAND_NAMES, COMMANDS } from '../../src/cli/commands';

describe('COMMANDS', () => {
  it('lists the 13 commands once each and COMMAND_NAMES matches', () => {
    const names = COMMANDS.map((c) => c.name);

    expect(names).toEqual([
      'help',
      'example',
      'open',
      'poll',
      'answer',
      'append-steps',
      'patch-block',
      'show',
      'ack',
      'status',
      'serve',
      'stop',
      'skill',
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect([...COMMAND_NAMES]).toEqual(names);
  });

  it('every command has a usage that starts with pinpoint and its name, a summary and flags', () => {
    for (const command of COMMANDS) {
      const head = command.name === 'help' ? 'pinpoint' : `pinpoint ${command.name}`;
      expect(command.usage.startsWith(head)).toBe(true);
      expect(command.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(command.flags)).toBe(true);
    }
  });

  it('flags are listed for the commands that take them', () => {
    const flagsOf = (name: string) => COMMANDS.find((c) => c.name === name)?.flags ?? [];

    expect(flagsOf('open')).toEqual(['--no-open']);
    expect(flagsOf('poll')).toEqual(['--timeout-ms']);
    expect(flagsOf('answer')).toEqual(['--question', '--text', '--file', '--diagram']);
    expect(flagsOf('serve')).toEqual(['--port', '--state-dir', '--idle-ms']);
    expect(flagsOf('skill')).toEqual(['--check', '--install', '--out']);
    expect(flagsOf('stop')).toEqual([]);
  });
});
