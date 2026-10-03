import type { SseFrame } from '../shared/frames';
import { openStream } from './stream';

interface Client {
  send(frame: SseFrame): void;
  close(): void;
}

export function encodeFrame(f: SseFrame): string {
  return `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`;
}

export class SseHub {
  readonly #heartbeatMs: number;
  readonly #onChange: (() => void) | undefined;
  readonly #clients = new Map<string, Set<Client>>();

  constructor(options: { heartbeatMs: number; onChange?: () => void }) {
    this.#heartbeatMs = options.heartbeatMs;
    this.#onChange = options.onChange;
  }

  clients(planId: string): number {
    return this.#clients.get(planId)?.size ?? 0;
  }

  total(): number {
    let sum = 0;
    for (const set of this.#clients.values()) sum += set.size;
    return sum;
  }

  subscribe(planId: string, signal: AbortSignal, initial: SseFrame[]): Response {
    const stream = openStream(
      signal,
      { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      { heartbeatMs: this.#heartbeatMs, heartbeat: ': hb\n\n' },
    );
    let released = false;

    const release = (): void => {
      if (released) return;
      released = true;
      const set = this.#clients.get(planId);
      set?.delete(client);
      if (set?.size === 0) this.#clients.delete(planId);
      this.#onChange?.();
    };

    const client: Client = {
      send: (frame) => stream.write(encodeFrame(frame)),
      close: () => {
        release();
        stream.end();
      },
    };

    const set = this.#clients.get(planId) ?? new Set<Client>();
    set.add(client);
    this.#clients.set(planId, set);
    this.#onChange?.();
    stream.onClose(release);
    for (const frame of initial) client.send(frame);
    return stream.response;
  }

  broadcast(planId: string, frame: SseFrame): void {
    for (const client of [...(this.#clients.get(planId) ?? [])]) client.send(frame);
  }

  close(): void {
    for (const set of [...this.#clients.values()]) for (const client of [...set]) client.close();
  }
}
