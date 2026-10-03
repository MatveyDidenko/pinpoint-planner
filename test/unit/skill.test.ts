import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/run';
import { createSkillMarkdown, validateSkill } from '../../src/cli/skill';
import { fakeIo } from '../helpers/fake-io';

const COMMITTED_PATH = join(import.meta.dir, '..', '..', 'skills', 'pinpoint', 'SKILL.md');
const MAX_CHARS = 4000;

function skillIo(readFile: (p: string) => Promise<string>) {
  const out: string[] = [];
  const written: { path: string; content: string }[] = [];
  const io = fakeIo({
    env: { HOME: '/home/tester' },
    argv1: '/x/bin/pinpoint',
    stdout: (s) => {
      out.push(s);
    },
    readFile,
    writeFile: (path, content) => {
      written.push({ path, content });
      return Promise.resolve();
    },
  });
  return { io, out, written };
}

function onlyDocument(out: string[]): Record<string, unknown> {
  expect(out).toHaveLength(1);
  return JSON.parse((out[0] as string).trim());
}

describe('skill', () => {
  it('generated skill validates, fits 4000 chars and equals the committed file', () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });
    expect(validateSkill(md)).toEqual([]);
    expect(md.length).toBeGreaterThan(0);
    expect(md.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(md).toBe(readFileSync(COMMITTED_PATH, 'utf8'));
  });

  it('a skill over 4000 chars or with an unknown frontmatter key fails validation', () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });

    const padded = validateSkill(`${md}${'x'.repeat(MAX_CHARS)}`);
    expect(padded.map((issue) => issue.path)).toEqual(['size']);

    const extraKey = validateSkill(md.replace('\n---\n', '\nversion: 1\n---\n'));
    expect(extraKey.map((issue) => issue.path)).toEqual(['frontmatter.version']);

    const missingKey = validateSkill(md.replace(/^description:.*\n/m, ''));
    expect(missingKey.map((issue) => issue.path)).toEqual(['frontmatter.description']);

    const unknownCommand = validateSkill(`${md}\nTry \`pinpoint frobnicate\` next.\n`);
    expect(unknownCommand.map((issue) => issue.path)).toEqual(['body']);
    expect(unknownCommand[0]?.message).toContain('frobnicate');
  });

  it('skill writes the generated file to the committed path and reports its size', async () => {
    const { io, out, written } = skillIo(() => Promise.reject(new Error('unused')));
    expect(await run(['skill'], io)).toBe(0);
    const md = createSkillMarkdown({ invocation: 'pinpoint' });
    expect(written).toEqual([{ path: COMMITTED_PATH, content: md }]);
    const doc = onlyDocument(out);
    expect(doc).toMatchObject({ status: 'skill-written', path: COMMITTED_PATH, chars: md.length });
    expect(typeof doc.next_step).toBe('string');
  });

  it('skill --check exits 0 when the committed copy matches and 1 when it differs', async () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });
    const same = skillIo(() => Promise.resolve(md));
    expect(await run(['skill', '--check'], same.io)).toBe(0);
    expect(onlyDocument(same.out)).toMatchObject({ status: 'skill-ok', path: COMMITTED_PATH });
    expect(same.written).toEqual([]);

    const stale = skillIo(() => Promise.resolve(`${md}\nstale`));
    expect(await run(['skill', '--check'], stale.io)).toBe(1);
    expect(onlyDocument(stale.out)).toEqual({
      status: 'error',
      code: 'INVALID_INPUT',
      message: 'skills/pinpoint/SKILL.md is out of date',
      next_step: 'Run `pinpoint skill` to regenerate it, then commit the file.',
    });
    expect(stale.written).toEqual([]);
  });
});
