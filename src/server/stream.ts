export interface StreamOptions {
  heartbeatMs: number;
  heartbeat: string;
}

export interface OpenedStream {
  response: Response;
  write(chunk: string): void;
  end(chunk?: string): void;
  onClose(fn: () => void): void;
}

/**
 * Opens a 200 streaming response that writes `heartbeat` immediately and every `heartbeatMs` until `end`.
 *
 * Ending, `signal` aborting and the reader cancelling all run one idempotent cleanup that clears the
 * interval and fires every `onClose` callback exactly once; writes after cleanup are ignored.
 */
export function openStream(signal: AbortSignal, headers: HeadersInit, options: StreamOptions): OpenedStream {
  const encoder = new TextEncoder();
  const closers: Array<() => void> = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const write = (chunk: string): void => {
    if (!closed) controller?.enqueue(encoder.encode(chunk));
  };

  const close = (closeController: boolean): void => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    signal.removeEventListener('abort', onAbort);
    if (closeController) controller?.close();
    for (const fn of closers) fn();
  };

  function onAbort(): void {
    close(true);
  }

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      close(false);
    },
  });

  if (signal.aborted) {
    close(true);
  } else {
    signal.addEventListener('abort', onAbort);
    write(options.heartbeat);
    interval = setInterval(() => write(options.heartbeat), options.heartbeatMs);
    interval.unref();
  }

  return {
    response: new Response(body, { status: 200, headers }),
    write,
    end(chunk) {
      if (chunk !== undefined) write(chunk);
      close(true);
    },
    onClose(fn) {
      if (closed) fn();
      else closers.push(fn);
    },
  };
}
