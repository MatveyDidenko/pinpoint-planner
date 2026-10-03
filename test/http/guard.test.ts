import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { hostGuard, isLoopbackHostname, limitBody, originGuard } from '../../src/server/guard.ts';

function guardedApp() {
  const app = new Hono();
  app.use('*', hostGuard());
  app.use('*', originGuard());
  app.all('/x', (c) => c.json({ ok: true }));
  return app;
}

describe('isLoopbackHostname', () => {
  test('accepts the three loopback spellings and nothing else', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('evil.com')).toBe(false);
    expect(isLoopbackHostname('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackHostname('')).toBe(false);
  });

  test('matches what URL.hostname reports for IPv6', () => {
    expect(isLoopbackHostname(new URL('http://[::1]:4777/').hostname)).toBe(true);
  });
});

describe('hostGuard', () => {
  test('a request to http://evil.com is rejected and one via app.request passes', async () => {
    const app = guardedApp();

    const evil = await app.request('http://evil.com/x');
    expect(evil.status).toBe(403);
    const body = (await evil.json()) as { code: string; message: string };
    expect(body.code).toBe('FORBIDDEN');
    expect(typeof body.message).toBe('string');

    expect((await app.request('/x')).status).toBe(200);
    expect((await app.request('http://127.0.0.1:4777/x')).status).toBe(200);
    expect((await app.request('http://[::1]:4777/x')).status).toBe(200);
  });

  test('a rebinding-style host that merely starts with 127.0.0.1 is rejected', async () => {
    const res = await guardedApp().request('http://127.0.0.1.evil.com/x');
    expect(res.status).toBe(403);
  });
});

describe('originGuard', () => {
  test('POST with Origin http://evil.com is 403 while Origin http://127.0.0.1:4777 and no Origin pass', async () => {
    const app = guardedApp();

    const evil = await app.request('/x', { method: 'POST', headers: { Origin: 'http://evil.com' } });
    expect(evil.status).toBe(403);
    expect(((await evil.json()) as { code: string }).code).toBe('FORBIDDEN');

    const local = await app.request('/x', { method: 'POST', headers: { Origin: 'http://127.0.0.1:4777' } });
    expect(local.status).toBe(200);
    const localhost = await app.request('/x', { method: 'POST', headers: { Origin: 'http://localhost:4777' } });
    expect(localhost.status).toBe(200);
    const none = await app.request('/x', { method: 'POST' });
    expect(none.status).toBe(200);
  });

  test('an unparsable or null Origin on a mutating request is 403', async () => {
    const app = guardedApp();
    for (const origin of ['null', 'not a url', 'http://127.0.0.1.evil.com']) {
      const res = await app.request('/x', { method: 'POST', headers: { Origin: origin } });
      expect(res.status).toBe(403);
    }
  });

  test('PUT, PATCH and DELETE are checked like POST', async () => {
    const app = guardedApp();
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/x', { method, headers: { Origin: 'http://evil.com' } });
      expect(res.status).toBe(403);
    }
  });

  test('GET with a foreign Origin is not blocked by the origin guard', async () => {
    const res = await guardedApp().request('/x', { headers: { Origin: 'http://evil.com' } });
    expect(res.status).toBe(200);
  });
});

describe('limitBody', () => {
  function limitedApp(maxBytes: number) {
    const app = new Hono();
    app.use('*', limitBody(maxBytes));
    app.post('/x', async (c) => {
      const text = await c.req.text();
      return c.json({ received: text.length });
    });
    return app;
  }

  function streamOf(text: string) {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8));
        controller.enqueue(bytes.slice(8));
        controller.close();
      },
    });
  }

  test('a body over the limit is 413 BODY_TOO_LARGE', async () => {
    const res = await limitedApp(16).request('/x', { method: 'POST', body: 'x'.repeat(17) });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('BODY_TOO_LARGE');
    expect(typeof body.message).toBe('string');
  });

  test('a body exactly at the limit passes', async () => {
    const res = await limitedApp(16).request('/x', { method: 'POST', body: 'x'.repeat(16) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 16 });
  });

  test('a streamed body over the limit without Content-Length is 413 and one at the limit passes', async () => {
    const app = limitedApp(16);
    const over = await app.request('/x', {
      method: 'POST',
      body: streamOf('x'.repeat(17)),
      duplex: 'half',
    } as RequestInit);
    expect(over.status).toBe(413);
    expect(((await over.json()) as { code: string }).code).toBe('BODY_TOO_LARGE');

    const exact = await app.request('/x', {
      method: 'POST',
      body: streamOf('x'.repeat(16)),
      duplex: 'half',
    } as RequestInit);
    expect(exact.status).toBe(200);
    expect(await exact.json()).toEqual({ received: 16 });
  });
});
