import type { BrowserMessage } from '../core/schema';
import type { PostMessageResponse } from '../shared/frames';
import { swapBlock } from './patch';

export const UNREACHABLE_MESSAGE = 'Could not reach the Pinpoint server.';

async function failureMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') {
      return body.message;
    }
  } catch {
    // body was not JSON; fall through to the status line
  }
  return `The server answered ${response.status}.`;
}

/** Posts `message`, swaps the returned block into the page, and throws an Error carrying the text to show the user on failure. */
export async function postMessage(planId: string, message: BrowserMessage): Promise<PostMessageResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/plans/${encodeURIComponent(planId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch {
    throw new Error(UNREACHABLE_MESSAGE);
  }
  if (!response.ok) throw new Error(await failureMessage(response));
  const result = (await response.json()) as PostMessageResponse;
  if (result.block !== undefined) swapBlock(result.block.html, result.block.rev);
  return result;
}
