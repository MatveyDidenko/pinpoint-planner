import { describe, expect, it } from 'bun:test';
import { shouldApply } from '../../src/shared/frames';

describe('shouldApply', () => {
  it('shouldApply accepts only a strictly newer rev', () => {
    expect(shouldApply(3, 4)).toBe(true);
    expect(shouldApply(3, 3)).toBe(false);
    expect(shouldApply(3, 2)).toBe(false);
    expect(shouldApply(0, 1)).toBe(true);
  });
});
