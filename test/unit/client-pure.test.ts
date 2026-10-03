import { describe, expect, it } from 'bun:test';
import { parseFrame } from '../../src/client/live';

describe('parseFrame', () => {
  it('parseFrame decodes a known event with a JSON object payload', () => {
    const data = { blockId: 'opt-b', rev: 2, html: '<section></section>', revision: 5 };

    expect(parseFrame('block', JSON.stringify(data))).toEqual({ event: 'block', data });
  });

  it('parseFrame rejects an unknown event name', () => {
    expect(parseFrame('teleport', '{"revision":1}')).toBeNull();
  });

  it('parseFrame rejects a payload that is not a JSON object', () => {
    expect(parseFrame('plan', '{not json')).toBeNull();
    expect(parseFrame('plan', '7')).toBeNull();
    expect(parseFrame('plan', 'null')).toBeNull();
  });
});
