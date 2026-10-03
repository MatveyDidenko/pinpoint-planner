import { describe, expect, it } from 'bun:test';
import { composerKeyAction } from '../../src/client/composer';
import { draftKey } from '../../src/client/draft';
import { EXCERPT_LIMIT, excerptFrom } from '../../src/client/excerpt';
import { parseFrame } from '../../src/client/live';
import { EXCERPT_MAX } from '../../src/core/schema';

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

describe('composerKeyAction', () => {
  const key = (name: string, shiftKey = false, isComposing = false) => ({ key: name, shiftKey, isComposing });

  it('composerKeyAction table', () => {
    const rows: [ReturnType<typeof key>, boolean, ReturnType<typeof composerKeyAction>][] = [
      [key('Enter'), false, 'send'],
      [key('Enter', true), false, 'newline'],
      [key('Escape'), true, 'close'],
      [key('Escape'), false, 'none'],
      [key('Enter', false, true), false, 'none'],
      [key('Escape', false, true), true, 'none'],
      [key('a'), true, 'none'],
    ];

    for (const [event, textEmpty, expected] of rows) {
      expect(composerKeyAction(event, textEmpty)).toBe(expected);
    }
  });
});

describe('excerptFrom', () => {
  it('excerptFrom trims and caps at 200 chars', () => {
    const long = 'a'.repeat(EXCERPT_MAX + 50);
    const rows: [string | null, string | null, number, string | undefined][] = [
      ['  hello  world \n', null, EXCERPT_MAX, 'hello world'],
      ['line one\n\nline two', null, EXCERPT_MAX, 'line one line two'],
      ['picked text', 'Fetch wrapper', EXCERPT_MAX, 'picked text'],
      ['   ', ' Fetch   wrapper ', EXCERPT_MAX, 'Fetch wrapper'],
      [null, 'Refresh timer', EXCERPT_MAX, 'Refresh timer'],
      [null, null, EXCERPT_MAX, undefined],
      ['  ', '', EXCERPT_MAX, undefined],
      [long, null, EXCERPT_MAX, 'a'.repeat(EXCERPT_MAX)],
      ['ab cd', null, 3, 'ab'],
    ];

    for (const [selection, label, max, expected] of rows) {
      expect(excerptFrom(selection, label, max)).toBe(expected);
    }
  });

  it('the client excerpt limit matches the schema limit', () => {
    expect(EXCERPT_LIMIT).toBe(EXCERPT_MAX);
  });
});

describe('draftKey', () => {
  it('draftKey is stable and namespaced', () => {
    expect(draftKey('plan-1', 'opt-c')).toBe(draftKey('plan-1', 'opt-c'));
    expect(draftKey('plan-1', 'opt-c')).toStartWith('pinpoint:draft:');
    expect(draftKey('plan-1', 'opt-c')).not.toBe(draftKey('plan-1', 'opt-a'));
    expect(draftKey('plan-1', 'opt-c')).not.toBe(draftKey('plan-2', 'opt-c'));
    expect(draftKey('a:b', 'c')).not.toBe(draftKey('a', 'b:c'));
  });
});
