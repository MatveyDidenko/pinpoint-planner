import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type PlanInput,
  parseAnswerInput,
  parseBlockInput,
  parseBrowserMessage,
  parsePlanInput,
  parseStepsInput,
  type Result,
} from '../../src/core/schema';
import { deriveBlocks } from '../../src/core/state';

const fixturesDir = join(import.meta.dir, '..', 'fixtures');

function load(relative: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, relative), 'utf8'));
}

function issuePaths(result: Result<unknown>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

describe('schema', () => {
  it('a valid plan fixture parses and keeps option order', () => {
    const result = parsePlanInput(load('plan.auth-refresh.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options.map((option) => option.id)).toEqual(['opt-a', 'opt-b', 'opt-c']);
  });

  function planWithOptions(count: number) {
    const plan = load('plan.auth-refresh.json') as PlanInput;
    const [, , last] = plan.options;
    const extra = ['opt-d', 'opt-e'].map((id) => ({ ...last, id }));
    return { ...plan, options: [...plan.options, ...extra].slice(0, count) };
  }

  it('a plan with two or four options parses', () => {
    expect(parsePlanInput(planWithOptions(2)).ok).toBe(true);
    const four = parsePlanInput(planWithOptions(4));
    expect(four.ok).toBe(true);
    if (!four.ok) return;
    expect(deriveBlocks(four.value, 1).map((block) => block.label)).toContain('Way D · Refresh at each call site');
  });

  it('a plan with one or five options fails on options', () => {
    expect(issuePaths(parsePlanInput(planWithOptions(1)))).toContain('options');
    expect(issuePaths(parsePlanInput(planWithOptions(5)))).toContain('options');
  });

  it.each([
    ['steps.opt-a.json', parseStepsInput],
    ['steps.opt-c.json', parseStepsInput],
    ['answer.opt-b.json', parseAnswerInput],
    ['block.opt-b.patched.json', parseBlockInput],
  ] as const)('the valid fixture %s parses', (file, parse) => {
    expect(parse(load(file)).ok).toBe(true);
  });

  it.each([
    ['plan.five-options.json', parsePlanInput, 'options'],
    ['plan.two-recommended.json', parsePlanInput, 'options'],
    ['plan.recommended-without-why.json', parsePlanInput, 'options.0.why'],
    ['plan.duplicate-option-id.json', parsePlanInput, 'options.1.id'],
    ['plan.option-id-findings.json', parsePlanInput, 'options.1.id'],
    ['plan.edge-unknown-node.json', parsePlanInput, 'options.1.diagram.edges.0.to'],
    ['plan.self-loop-edge.json', parsePlanInput, 'options.0.diagram.edges.0.to'],
    ['plan.nine-nodes.json', parsePlanInput, 'options.0.diagram.nodes'],
    ['plan.long-summary.json', parsePlanInput, 'findings.summary'],
    ['plan.bad-id.json', parsePlanInput, 'id'],
    ['message.ask-empty-text.json', parseBrowserMessage, 'text'],
    ['message.choose-with-text.json', parseBrowserMessage, 'text'],
  ] as const)('each invalid fixture reports the expected issue path: %s', (file, parse, path) => {
    const result = parse(load(`invalid/${file}`));
    expect(result.ok).toBe(false);
    expect(issuePaths(result)).toContain(path);
  });

  it('threadId is allowed on ask and rejected on choose and done', () => {
    const reply = { clientId: 'client-01', threadId: 'm-1' };

    expect(parseBrowserMessage({ ...reply, kind: 'ask', blockId: 'opt-b', text: 'And?' }).ok).toBe(true);
    expect(
      issuePaths(parseBrowserMessage({ ...reply, kind: 'ask', blockId: 'opt-b', text: 'And?', threadId: 'M 1' })),
    ).toEqual(['threadId']);
    expect(issuePaths(parseBrowserMessage({ ...reply, kind: 'choose', optionId: 'opt-b', text: '' }))).toEqual([
      'threadId',
    ]);
    expect(issuePaths(parseBrowserMessage({ ...reply, kind: 'done', text: '' }))).toEqual(['threadId']);
  });

  it('proposal is allowed on ask and rejected on choose and done', () => {
    const proposal = { nodes: [{ id: 'cache', label: 'Cache', status: 'new' }], edges: [] };
    const base = { clientId: 'client-01', proposal };

    expect(parseBrowserMessage({ ...base, kind: 'ask', blockId: 'opt-b', text: 'Mine?' }).ok).toBe(true);
    expect(
      issuePaths(
        parseBrowserMessage({
          ...base,
          kind: 'ask',
          blockId: 'opt-b',
          text: 'Mine?',
          proposal: { nodes: [], edges: [] },
        }),
      ),
    ).toEqual(['proposal.nodes']);
    expect(issuePaths(parseBrowserMessage({ ...base, kind: 'choose', optionId: 'opt-b', text: '' }))).toEqual([
      'proposal',
    ]);
    expect(issuePaths(parseBrowserMessage({ ...base, kind: 'done', text: '' }))).toEqual(['proposal']);
  });

  const PNG_PREFIX = 'data:image/png;base64,';

  it('an ask with a PNG data URL sketch parses', () => {
    const sketch = `${PNG_PREFIX}iVBORw0KGgo=`;
    const result = parseBrowserMessage({ clientId: 'client-01', kind: 'ask', blockId: 'opt-b', text: 'This?', sketch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sketch).toBe(sketch);
  });

  it('a sketch that is not a PNG data URL or is over the cap fails', () => {
    const asking = { clientId: 'client-01', kind: 'ask', blockId: 'opt-b', text: 'This?' };
    const sketchIssues = (sketch: string, over: Record<string, unknown> = asking) =>
      issuePaths(parseBrowserMessage({ ...over, sketch }));

    expect(sketchIssues('data:image/jpeg;base64,/9j/4AAQ')).toEqual(['sketch']);
    expect(sketchIssues('iVBORw0KGgo=')).toEqual(['sketch']);
    expect(sketchIssues(PNG_PREFIX + 'A'.repeat(700_000 - PNG_PREFIX.length))).toEqual([]);
    expect(sketchIssues(PNG_PREFIX + 'A'.repeat(700_001 - PNG_PREFIX.length))).toEqual(['sketch']);
    expect(
      sketchIssues(`${PNG_PREFIX}AA==`, { clientId: 'client-01', kind: 'choose', optionId: 'opt-b', text: '' }),
    ).toEqual(['sketch']);
    expect(sketchIssues(`${PNG_PREFIX}AA==`, { clientId: 'client-01', kind: 'done', text: '' })).toEqual(['sketch']);
  });
});
