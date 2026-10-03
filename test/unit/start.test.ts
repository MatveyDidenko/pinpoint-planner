import { describe, expect, test } from 'bun:test';
import { serveOptions } from '../../src/server/start';

describe('serveOptions', () => {
  test('serveOptions sets idleTimeout 0 and binds 127.0.0.1', () => {
    const fetch = () => new Response('ok');

    const options = serveOptions({ port: 4777, fetch });

    expect(options.idleTimeout).toBe(0);
    expect(options.hostname).toBe('127.0.0.1');
    expect(options.port).toBe(4777);
    expect(options.fetch).toBe(fetch);
  });
});
