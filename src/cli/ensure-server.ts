import { join } from 'node:path';
import { apiClient, type HealthResponse } from './api';
import { CliError } from './errors';
import type { CliIo, Config } from './io';

const DEFAULT_DEADLINE_MS = 5000;
const RETRY_INTERVAL_MS = 100;

/** Returns the helper's health document, spawning the helper once if nothing answers on the port. */
export async function ensureServer(
  io: CliIo,
  cfg: Config,
  { deadlineMs = DEFAULT_DEADLINE_MS }: { deadlineMs?: number } = {},
): Promise<HealthResponse> {
  const api = apiClient(io.fetch, cfg.baseUrl);

  const probe = async (): Promise<HealthResponse | undefined> => {
    let health: HealthResponse;
    try {
      health = await api.health();
    } catch (error) {
      if (error instanceof CliError && error.code === 'SERVER_UNREACHABLE') return undefined;
      throw error;
    }
    if (health.app !== 'pinpoint') {
      throw new CliError('SERVER_UNREACHABLE', `another program is answering on port ${cfg.port}, not the helper`);
    }
    return health;
  };

  const running = await probe();
  if (running !== undefined) return running;

  await io.spawnDaemon(cfg);
  const startedAt = io.now().getTime();
  for (let waited = 0; waited < deadlineMs; waited = io.now().getTime() - startedAt) {
    await io.sleep(Math.min(RETRY_INTERVAL_MS, deadlineMs - waited));
    const health = await probe();
    if (health !== undefined) return health;
  }
  throw new CliError(
    'SERVER_UNREACHABLE',
    `could not reach the helper at ${cfg.baseUrl}; see ${join(cfg.stateDir, 'helper.log')}`,
  );
}
