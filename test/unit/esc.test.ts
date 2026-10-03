import { describe, expect, it } from 'bun:test';
import { attr, esc, jsonScript } from '../../src/core/render/esc';

describe('esc and attr', () => {
  const rows: { name: string; input: string; expected: string }[] = [
    { name: 'script close tag', input: '</script>', expected: '&lt;/script&gt;' },
    { name: 'ampersand', input: 'a & b', expected: 'a &amp; b' },
    { name: 'already-escaped entity is escaped again', input: '&lt;', expected: '&amp;lt;' },
    { name: 'double quote', input: 'say "hi"', expected: 'say &quot;hi&quot;' },
    { name: 'single quote', input: "it's", expected: 'it&#39;s' },
    { name: 'angle brackets', input: '<img src=x onerror=alert(1)>', expected: '&lt;img src=x onerror=alert(1)&gt;' },
    { name: 'attribute breakout', input: '" onmouseover="x', expected: '&quot; onmouseover=&quot;x' },
    { name: 'plain text is untouched', input: 'hello world', expected: 'hello world' },
    { name: 'empty string', input: '', expected: '' },
  ];

  it('esc and attr neutralise quotes, angle brackets and ampersands', () => {
    for (const row of rows) {
      expect(esc(row.input), `esc: ${row.name}`).toBe(row.expected);
      expect(attr(row.input), `attr: ${row.name}`).toBe(row.expected);
    }
  });
});

describe('jsonScript', () => {
  it('jsonScript output contains no raw < or line separators and round-trips through JSON.parse', () => {
    const value = {
      text: '</script><!-- <b>&amp;</b>',
      separators: 'a\u2028b\u2029c',
      nested: [{ quote: '"', angle: '>' }, 1, null, true],
    };
    const out = jsonScript(value);

    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u2028');
    expect(JSON.parse(out)).toEqual(value);
  });
});
