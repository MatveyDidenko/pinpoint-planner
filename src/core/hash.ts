import { createHash } from 'node:crypto';
import type { Block, PlanState } from './types';

export function sha16(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export function untouchedHash(
  plan: PlanState['plan'],
  touched: readonly string[],
  render: (b: Block) => string,
): string {
  const rendered = plan.blocks.filter((b) => !touched.includes(b.id)).map(render);
  return sha16(rendered.join('\n'));
}
