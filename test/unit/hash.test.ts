import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha16, untouchedHash } from '../../src/core/hash';
import { parsePlanInput } from '../../src/core/schema';
import { openPlan, postMessage } from '../../src/core/state';
import type { Block, PlanState } from '../../src/core/types';

const NOW = '2026-10-03T10:00:00.000Z';

function loadState(): PlanState {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'plan.auth-refresh.json'), 'utf8'));
  const parsed = parsePlanInput(raw);
  if (!parsed.ok) throw new Error('fixture plan is invalid');
  return openPlan(parsed.value, NOW);
}

const render = (b: Block): string => JSON.stringify(b);

describe('untouchedHash', () => {
  it('untouchedHash ignores the touched block and changes when any other block changes', () => {
    const before = loadState();
    const asked = postMessage(
      before,
      { clientId: 'client-01', kind: 'ask', blockId: 'opt-b', text: 'Why a timer?' },
      NOW,
    );

    expect(untouchedHash(asked.state.plan, asked.touched, render)).toBe(
      untouchedHash(before.plan, asked.touched, render),
    );
    expect(untouchedHash(asked.state.plan, [], render)).not.toBe(untouchedHash(before.plan, [], render));

    const edited = {
      ...before.plan,
      blocks: before.plan.blocks.map((b) => (b.id === 'opt-a' ? { ...b, label: 'changed' } : b)),
    };
    expect(untouchedHash(edited, ['opt-b'], render)).not.toBe(untouchedHash(before.plan, ['opt-b'], render));
  });

  it('sha16 matches a known vector and untouchedHash with every block touched hashes the empty string', () => {
    expect(sha16('')).toBe('e3b0c44298fc1c14');
    expect(sha16('abc')).toBe('ba7816bf8f01cfea');

    const { plan } = loadState();
    expect(
      untouchedHash(
        plan,
        plan.blocks.map((b) => b.id),
        render,
      ),
    ).toBe(sha16(''));
  });
});
