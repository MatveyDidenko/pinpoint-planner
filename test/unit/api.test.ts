import { describe, expect, it } from 'bun:test';
import { apiClient } from '../../src/cli/api';
import { CliError } from '../../src/cli/errors';
import { parsePlanInput } from '../../src/core/schema';
import { asFetch } from '../helpers/fake-io';
import { fixture, makeTestApp, seedPlan, TEST_BASE_URL, type TestApp } from '../helpers/test-app';

const appFetch = (t: TestApp): typeof fetch => asFetch(async (input, init) => t.app.request(input, init));

const jsonResponse = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected the promise to reject');
}

function planInput(id: string) {
  const parsed = parsePlanInput({ ...fixture('plan.auth-refresh'), id });
  if (!parsed.ok) throw new Error('fixture plan does not parse');
  return parsed.value;
}

describe('apiClient errors', () => {
  it('a 404 body becomes CliError NOT_FOUND with the server message', async () => {
    const t = makeTestApp();
    const api = apiClient(appFetch(t), TEST_BASE_URL);

    const error = await failure(api.getPlan('missing'));

    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('no plan missing');
    expect(error.status).toBe(404);
  });

  it('an invalid body keeps the server issues on the CliError', async () => {
    const t = makeTestApp();
    const api = apiClient(appFetch(t), TEST_BASE_URL);

    const error = await failure(api.ack('auth-refresh', []));

    expect(error.code).toBe('INVALID_INPUT');
    expect(error.status).toBe(400);
    expect(error.issues?.[0]?.path).toBe('ids');
  });

  it('a server code outside the CLI catalogue maps to IO and keeps the code in the message', async () => {
    const t = makeTestApp();
    const api = apiClient(appFetch(t), 'http://example.com');

    const error = await failure(api.listPlans());

    expect(error.code).toBe('IO');
    expect(error.message).toContain('FORBIDDEN');
    expect(error.status).toBe(403);
  });

  it('a non-json error body maps to IO with the status', async () => {
    const api = apiClient(
      asFetch(async () => new Response('<html>bad gateway</html>', { status: 502 })),
      TEST_BASE_URL,
    );

    const error = await failure(api.health());

    expect(error.code).toBe('IO');
    expect(error.status).toBe(502);
  });

  it('a rejected fetch becomes SERVER_UNREACHABLE and a truncated poll body becomes POLL_INTERRUPTED', async () => {
    const refused = apiClient(
      asFetch(async () => {
        throw new TypeError('fetch failed');
      }),
      TEST_BASE_URL,
    );
    expect((await failure(refused.health())).code).toBe('SERVER_UNREACHABLE');
    expect((await failure(refused.poll('auth-refresh'))).code).toBe('SERVER_UNREACHABLE');

    const truncated = apiClient(
      asFetch(async () => jsonResponse('  {"status":')),
      TEST_BASE_URL,
    );
    expect((await failure(truncated.poll('auth-refresh'))).code).toBe('POLL_INTERRUPTED');

    const onlyHeartbeats = apiClient(
      asFetch(async () => jsonResponse('   ')),
      TEST_BASE_URL,
    );
    expect((await failure(onlyHeartbeats.poll('auth-refresh'))).code).toBe('POLL_INTERRUPTED');

    const reset = apiClient(
      asFetch(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(' '));
            controller.error(new Error('reset'));
          },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
      TEST_BASE_URL,
    );
    expect((await failure(reset.poll('auth-refresh'))).code).toBe('POLL_INTERRUPTED');
  });
});

describe('apiClient routes', () => {
  it('openPlan reports replaced from the status and the stored plan and block read back', async () => {
    const t = makeTestApp();
    const api = apiClient(appFetch(t), TEST_BASE_URL);

    const created = await api.openPlan('auth-refresh', planInput('auth-refresh'));
    const replaced = await api.openPlan('auth-refresh', planInput('auth-refresh'));
    const state = await api.getPlan('auth-refresh');
    const block = await api.getBlock('auth-refresh', created.block_ids[0] ?? '');

    expect(created.replaced).toBe(false);
    expect(replaced.replaced).toBe(true);
    expect(created.url).toBe(`${TEST_BASE_URL}/plans/auth-refresh`);
    expect(state.plan.id).toBe('auth-refresh');
    expect(block.id).toBe(created.block_ids[0] ?? '');
    expect((await api.listPlans()).map((p) => p.id)).toEqual(['auth-refresh']);
    expect((await api.health()).app).toBe('pinpoint');
  });

  it('the bound invocation reaches the server so next_step names it', async () => {
    const t = makeTestApp();
    await seedPlan(t);
    const api = apiClient(appFetch(t), TEST_BASE_URL, 'bun /opt/pinpoint/bin/pinpoint.ts');

    const waiting = await api.poll('auth-refresh', 0);
    const receipt = await api.ack('auth-refresh', ['m-404']).catch((error: CliError) => error);

    expect(waiting.status).toBe('waiting');
    expect(waiting.next_step).toContain('bun /opt/pinpoint/bin/pinpoint.ts poll auth-refresh');
    expect(receipt).toBeInstanceOf(CliError);
    expect((receipt as CliError).code).toBe('NOT_FOUND');
  });
});
