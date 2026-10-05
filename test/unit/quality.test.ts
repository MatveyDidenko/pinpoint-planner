import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { undefinedAcronyms } from '../../src/core/quality';
import { type PlanInput, parsePlanInput } from '../../src/core/schema';

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
