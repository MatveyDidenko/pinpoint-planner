import { describe, expect, it } from 'bun:test';
import { renderMarkdown } from '../../src/core/markdown';

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer"';

const rows: { name: string; input: string; expected: string }[] = [
  { name: 'empty input', input: '', expected: '' },
  { name: 'whitespace-only input', input: '  \n\n \n', expected: '' },
  { name: 'paragraph', input: 'hello world', expected: '<p>hello world</p>' },
  { name: 'two paragraphs', input: 'a\n\nb', expected: '<p>a</p><p>b</p>' },
  { name: 'blank line with spaces separates paragraphs', input: 'a\n  \nb', expected: '<p>a</p><p>b</p>' },
  { name: 'single newline becomes br', input: 'a\nb', expected: '<p>a<br>b</p>' },
  { name: 'crlf line endings', input: 'a\r\nb\r\n\r\nc', expected: '<p>a<br>b</p><p>c</p>' },
  { name: 'bold', input: 'a **b** c', expected: '<p>a <strong>b</strong> c</p>' },
  { name: 'italic', input: 'a *b* c', expected: '<p>a <em>b</em> c</p>' },
  { name: 'italic inside bold', input: '**a *b* c**', expected: '<p><strong>a <em>b</em> c</strong></p>' },
  { name: 'inline code', input: 'run `bun test` now', expected: '<p>run <code>bun test</code> now</p>' },
  {
    name: 'code span is not emphasised',
    input: '`**x** *y*`',
    expected: '<p><code>**x** *y*</code></p>',
  },
  { name: 'code span content is escaped', input: '`<b>&`', expected: '<p><code>&lt;b&gt;&amp;</code></p>' },
  { name: 'spaced asterisks stay literal', input: '2 * 3 * 4', expected: '<p>2 * 3 * 4</p>' },
  { name: 'unbalanced bold stays literal', input: '**a', expected: '<p>**a</p>' },
  {
    name: 'https link',
    input: '[docs](https://example.com/a)',
    expected: `<p><a href="https://example.com/a" ${LINK_ATTRS}>docs</a></p>`,
  },
  {
    name: 'http link with ampersand in the query',
    input: '[q](http://example.com/?a=1&b=2)',
    expected: `<p><a href="http://example.com/?a=1&amp;b=2" ${LINK_ATTRS}>q</a></p>`,
  },
  {
    name: 'link label can be bold',
    input: '[**docs**](https://example.com)',
    expected: `<p><a href="https://example.com" ${LINK_ATTRS}><strong>docs</strong></a></p>`,
  },
  {
    name: 'asterisks inside a url are not emphasis',
    input: '[a](https://example.com/*x*)',
    expected: `<p><a href="https://example.com/*x*" ${LINK_ATTRS}>a</a></p>`,
  },
  { name: 'bullet list', input: '- a\n- b', expected: '<ul><li>a</li><li>b</li></ul>' },
  { name: 'numbered list', input: '1. a\n2. b', expected: '<ol><li>a</li><li>b</li></ol>' },
  {
    name: 'list items take inline rules',
    input: '- **a** `b`\n- [c](https://example.com)',
    expected: `<ul><li><strong>a</strong> <code>b</code></li><li><a href="https://example.com" ${LINK_ATTRS}>c</a></li></ul>`,
  },
  {
    name: 'paragraph then list then paragraph',
    input: 'intro\n\n- a\n- b\n\noutro',
    expected: '<p>intro</p><ul><li>a</li><li>b</li></ul><p>outro</p>',
  },
  { name: 'mixed block is a paragraph', input: '- a\nplain', expected: '<p>- a<br>plain</p>' },
  { name: 'heading stays literal', input: '# Title', expected: '<p># Title</p>' },
  {
    name: 'image stays literal',
    input: '![alt](https://example.com/x.png)',
    expected: '<p>![alt](https://example.com/x.png)</p>',
  },
  { name: 'table stays literal', input: '| a | b |\n|---|---|', expected: '<p>| a | b |<br>|---|---|</p>' },
];

describe('renderMarkdown', () => {
  it.each(rows)('renders each supported construct to the exact expected html ($name)', ({ input, expected }) => {
    expect(renderMarkdown(input)).toBe(expected);
  });

  it('javascript: links, <img onerror> and </script> come out as text', () => {
    const hostile = [
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '<img src=x onerror=alert(1)>',
      '</script><script>alert(1)</script>',
      '[x](https://e.com/" onmouseover="alert(1))',
      '`</script>` **<b>x</b>** *<i>y</i>*',
      '- <img src=x onerror=alert(1)>',
      '1. </script>',
    ];
    const allowedTags =
      /<\/?(?:p|ul|ol|li|strong|em|code)>|<br>|<a href="[^"<>]*" target="_blank" rel="noopener noreferrer">|<\/a>/g;
    for (const input of hostile) {
      const html = renderMarkdown(input);
      expect(html.replace(allowedTags, ''), input).not.toContain('<');
      expect(html, input).not.toContain('href="javascript');
      expect(html.toLowerCase(), input).not.toContain('<img');
      expect(html.toLowerCase(), input).not.toContain('<script');
    }
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('is deterministic', () => {
    const md = '**a** [b](https://example.com)\n\n- c';
    expect(renderMarkdown(md)).toBe(renderMarkdown(md));
  });
});
