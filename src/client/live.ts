import type { SseFrame } from '../shared/frames';

type EventName = SseFrame['event'];

export type LiveHandlers = {
  [K in EventName]?: (data: Extract<SseFrame, { event: K }>['data']) => void;
};

const KNOWN_EVENTS: Record<EventName, true> = { hello: true, block: true, appended: true, presence: true, plan: true };
const EVENT_NAMES = Object.keys(KNOWN_EVENTS) as EventName[];

const isKnownEvent = (name: string): name is EventName => Object.hasOwn(KNOWN_EVENTS, name);

export function parseFrame(type: string, data: string): SseFrame | null {
  if (!isKnownEvent(type)) return null;
  try {
    const payload: unknown = JSON.parse(data);
    if (typeof payload !== 'object' || payload === null) return null;
    return { event: type, data: payload } as SseFrame;
  } catch {
    return null;
  }
}

function deliver(handlers: LiveHandlers, frame: SseFrame): void {
  switch (frame.event) {
    case 'hello':
      handlers.hello?.(frame.data);
      break;
    case 'block':
      handlers.block?.(frame.data);
      break;
    case 'appended':
      handlers.appended?.(frame.data);
      break;
    case 'presence':
      handlers.presence?.(frame.data);
      break;
    case 'plan':
      handlers.plan?.(frame.data);
      break;
  }
}

export function connectLive(planId: string, since: number, handlers: LiveHandlers): EventSource {
  const source = new EventSource(`/api/plans/${encodeURIComponent(planId)}/events?since=${since}`);
  for (const name of EVENT_NAMES) {
    source.addEventListener(name, (event) => {
      const frame = parseFrame(name, (event as MessageEvent<string>).data);
      if (frame !== null) deliver(handlers, frame);
    });
  }
  return source;
}
