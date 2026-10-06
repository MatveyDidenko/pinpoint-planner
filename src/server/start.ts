import type { Assets } from '../core/render/page';
import { VERSION } from '../version';
import { createApp, type PinpointApp } from './app';
import { buildClientAssets } from './assets';
import { filePersistence, memoryPersistence } from './persistence';
import { PlanStore } from './store';
import { IdleWatch } from './timers';

export interface StartOptions {
  port: number;
  stateDir: string | null;
  idleTimeoutMs?: number;
  heartbeatMs?: number;
  pollMaxWaitMs?: number;
  browserGraceMs?: number;
  clock?: () => Date;
  assets?: Assets;
}

export interface RunningServer {
  port: number;
  url: string;
  app: PinpointApp;
  closed: Promise<void>;
  close(): Promise<void>;
}

type ServeOptions = Bun.Serve.HostnamePortServeOptions<undefined> & {
  fetch: Bun.Serve.Handler<Request, Bun.Server<undefined>, Response>;
};

export function serveOptions(o: { port: number; fetch: ServeOptions['fetch'] }): ServeOptions {
  return { hostname: '127.0.0.1', port: o.port, idleTimeout: 0, fetch: o.fetch };
}

const DEFAULT_IDLE_TIMEOUT_MS = 1800000;

const systemClock = (): Date => new Date();

export async function startServer(o: StartOptions): Promise<RunningServer> {
  const clock = o.clock ?? systemClock;
  const persistence = o.stateDir === null ? memoryPersistence() : filePersistence(o.stateDir, clock);
  const assets = o.assets ?? (await buildClientAssets());
  let pinpoint: PinpointApp | undefined;
  let watch: IdleWatch | undefined;
  const server = Bun.serve(
    serveOptions({
      port: o.port,
      fetch: (req) => {
        watch?.poke();
        return (pinpoint as PinpointApp).app.fetch(req);
      },
    }),
  );
  const url = `http://127.0.0.1:${server.port}`;
  const app = createApp({
    store: new PlanStore(persistence, clock),
    assets,
    baseUrl: url,
    version: VERSION,
    startedAt: clock().toISOString(),
    stateDir: o.stateDir,
    clock,
    heartbeatMs: o.heartbeatMs,
    pollMaxWaitMs: o.pollMaxWaitMs,
    browserGraceMs: o.browserGraceMs,
    onActivity: () => watch?.poke(),
    onShutdown: () => void close(),
  });
  pinpoint = app;
  const closed = Promise.withResolvers<void>();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      watch?.close();
      // Bun spins at full CPU if this forced stop starts after app.close() with a poll and an SSE stream open.
      const stopped = server.stop(true);
      app.close();
      await stopped;
      closed.resolve();
    })();
    return closing;
  };
  watch = new IdleWatch({
    idleMs: o.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    isBusy: app.busy,
    onIdle: () => void close(),
  });
  return {
    port: server.port as number,
    url,
    app,
    closed: closed.promise,
    close,
  };
}
