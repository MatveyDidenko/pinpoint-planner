import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/run';
import { createSkillMarkdown, validateSkill } from '../../src/cli/skill';
import { ContextInputSchema, CostSchema, GraphSchema, OptionInputSchema, PlanInputSchema } from '../../src/core/schema';
import { fakeIo } from '../helpers/fake-io';

const COMMITTED_PATH = join(import.meta.dir, '..', '..', 'skills', 'pinpoint', 'SKILL.md');
const MAX_CHARS = 6000;

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
  it('generated skill validates, fits 6000 chars and equals the committed file', () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });
    expect(validateSkill(md)).toEqual([]);
    expect(md.length).toBeGreaterThan(0);
    expect(md.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(md).toBe(readFileSync(COMMITTED_PATH, 'utf8'));
  });

  it('a skill over 6000 chars or with an unknown frontmatter key fails validation', () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });

    expect(validateSkill(`${md}${'x'.repeat(MAX_CHARS - md.length)}`)).toEqual([]);
    const padded = validateSkill(`${md}${'x'.repeat(MAX_CHARS - md.length + 1)}`);
    expect(padded.map((issue) => issue.path)).toEqual(['size']);

    const extraKey = validateSkill(md.replace('\n---\n', '\nversion: 1\n---\n'));
    expect(extraKey.map((issue) => issue.path)).toEqual(['frontmatter.version']);

    const missingKey = validateSkill(md.replace(/^description:.*\n/m, ''));
    expect(missingKey.map((issue) => issue.path)).toEqual(['frontmatter.description']);

    const unknownCommand = validateSkill(`${md}\nTry \`pinpoint frobnicate\` next.\n`);
    expect(unknownCommand.map((issue) => issue.path)).toEqual(['body']);
    expect(unknownCommand[0]?.message).toContain('frobnicate');
  });

  it('a skill without frontmatter or with a malformed allowed-tools fails validation', () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });

    expect(validateSkill(md.slice('---\n'.length)).map((issue) => issue.path)).toEqual(['frontmatter']);
    const badTools = validateSkill(md.replace(/^allowed-tools:.*$/m, 'allowed-tools: Read'));
    expect(badTools.map((issue) => issue.path)).toEqual(['frontmatter.allowed-tools']);
  });

  it('the skill asks for two to four ways and never says exactly three', () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });

    expect(md).toMatch(/^description: .*two to four drawn options/m);
    expect(md).toMatch(/^3\. .*Draw the real ways, two to four; never pad to reach a count\./m);
    expect(md).not.toMatch(/exactly three|three (drawn )?(options|ways)/i);
  });

  it('the skill names every plan input key and does not call example plan', () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });
    const rule3 = md.slice(md.indexOf('\n3. '), md.indexOf('\n4. '));
    const keys = [PlanInputSchema, ContextInputSchema, OptionInputSchema, CostSchema, GraphSchema].flatMap((schema) =>
      Object.keys(schema.shape),
    );

    for (const key of keys) expect(rule3).toMatch(new RegExp(`[{,\\s]${key}[?:,}]`));
    expect(md).not.toContain('example plan');
  });

  it("the skill asks for today's flows and terms before the ways", () => {
    const md = createSkillMarkdown({ invocation: 'pinpoint' });
    const rule2 = md.slice(md.indexOf('\n2. '), md.indexOf('\n3. '));
    const rule3 = md.slice(md.indexOf('\n3. '), md.indexOf('\n4. '));

    expect(rule2).toContain(
      'Explain how it works today first: a summary, every acronym and project word in `terms`, and 1–3 current flows as steps.',
    );
    expect(rule3).toContain(
      'Give each way a 2–3 sentence summary; the diagram shows structure, the summary says how it behaves.',
    );
    expect(rule2).toContain('Never propose building what the code already does.');
    expect(md).not.toContain('findings');
  });

  it('the skill routes each thread to its own subagent and keeps the main agent the only writer', () => {
    const rules = createSkillMarkdown({ invocation: 'pinpoint' }).split('7. **Rules.**')[1] ?? '';

    for (const item of [
      'Each question thread gets its own Sonnet subagent; follow-ups go to the same one.',
      'You are the only writer: subagents return the answer, you run `answer`.',
      "Wait for this poll's subagents and write their answers before polling again.",
    ])
      expect(rules).toContain(`\n   - ${item}\n`);
  });

  it('the skill tells the agent to weigh proposals and sketches before patching', () => {
    const rules = createSkillMarkdown({ invocation: 'pinpoint' }).split('7. **Rules.**')[1] ?? '';

    expect(rules).toContain(
      "\n   - When a message carries `proposal_changes` or `sketch_path`, the subagent weighs the user's version; patch the block only after the user agrees in the thread.\n",
    );
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
