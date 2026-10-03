import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function hostGuard() {
  return createMiddleware(async (c, next) => {
    if (!isLoopbackHostname(new URL(c.req.url).hostname)) {
      return c.json({ code: 'FORBIDDEN', message: 'Requests must target a loopback host.' }, 403);
    }
    await next();
  });
}

export function originGuard() {
  return createMiddleware(async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin !== undefined && MUTATING_METHODS.has(c.req.method) && !isLoopbackOrigin(origin)) {
      return c.json({ code: 'FORBIDDEN', message: 'Cross-origin writes are not allowed.' }, 403);
    }
    await next();
  });
}

export const MAX_BODY_BYTES = 1024 * 1024;

export function limitBody(maxBytes: number) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) =>
      c.json({ code: 'BODY_TOO_LARGE', message: `Request bodies are limited to ${maxBytes} bytes.` }, 413),
  });
}
