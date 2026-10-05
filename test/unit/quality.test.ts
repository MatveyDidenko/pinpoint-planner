import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { patchAcronyms, undefinedAcronyms } from '../../src/core/quality';
import { type PlanInput, parsePlanInput } from '../../src/core/schema';
import { deriveBlocks } from '../../src/core/state';

function loadPlan(): PlanInput {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));
  const parsed = parsePlanInput(raw);
  if (!parsed.ok) throw new Error('fixture plan is invalid');
  return parsed.value;
}

describe('undefinedAcronyms', () => {
  it('an acronym in an option summary that no term defines is an issue at that path', () => {
    const plan = loadPlan();
    const summary = `${plan.options[1]?.summary} It pushes renewals to every tab over SSE.`;
    const options = plan.options.map((o) => (o.id === 'opt-b' ? { ...o, summary } : o));

    expect(undefinedAcronyms({ ...plan, options })).toEqual([
      { path: 'options.1.summary', message: 'define SSE in context.terms' },
    ]);
  });
});

describe('patchAcronyms', () => {
  it('an option patch is checked against the current terms and a context patch against its own', () => {
    const plan = loadPlan();
    const blocks = deriveBlocks(plan, 1);
    const option = plan.options[1];
    if (option === undefined) throw new Error('fixture has no second option');
    const summary = `${option.summary} It pushes renewals to every tab over SSE.`;

    expect(patchAcronyms(blocks, 'opt-b', { kind: 'option', ...option, summary })).toEqual([
      { path: 'summary', message: 'define SSE in context.terms' },
    ]);
    expect(patchAcronyms(blocks, 'opt-b', { kind: 'option', ...option })).toEqual([]);
    const context = {
      kind: 'context' as const,
      ...plan.context,
      summary: `${plan.context.summary} Over SSE.`,
      terms: [],
    };
    expect(patchAcronyms(blocks, 'context', context).map((issue) => issue.path)).toContain('summary');
  });
});
