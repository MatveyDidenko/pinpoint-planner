import { shouldApply } from '../shared/frames';

export const SWAPPED_EVENT = 'pinpoint:swapped';

const UPDATED_CLASS = 'is-updated';
const UPDATED_FALLBACK_MS = 1200;

function parseBlock(html: string): HTMLElement | null {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const element = template.content.firstElementChild;
  return element instanceof HTMLElement ? element : null;
}

function findBlock(blockId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-block="${CSS.escape(blockId)}"]`);
}

function markUpdated(element: HTMLElement): void {
  element.classList.add(UPDATED_CLASS);
  const clear = () => element.classList.remove(UPDATED_CLASS);
  element.addEventListener('animationend', clear, { once: true });
  setTimeout(clear, UPDATED_FALLBACK_MS);
}

/** Replaces the block carried by `html` when `rev` is newer than the one on the page; returns the new element or null. */
export function swapBlock(html: string, rev: number): HTMLElement | null {
  const next = parseBlock(html);
  const blockId = next?.dataset.block;
  if (next === null || blockId === undefined) return null;
  const current = findBlock(blockId);
  if (current === null || !shouldApply(Number(current.dataset.rev), rev)) return null;

  const selected = current.getAttribute('data-selected');
  if (selected !== null) next.setAttribute('data-selected', selected);
  current.replaceWith(next);
  markUpdated(next);
  document.dispatchEvent(new CustomEvent(SWAPPED_EVENT, { detail: { blockId } }));
  return next;
}

/** Inserts a new block into stage 04 after `after` (or at the end) and reveals the stage; a block already on the page is swapped instead. */
export function appendBlock(html: string, after: string | null): HTMLElement | null {
  const next = parseBlock(html);
  const blockId = next?.dataset.block;
  const grid = document.getElementById('steps-grid');
  if (next === null || blockId === undefined || grid === null) return null;
  if (findBlock(blockId) !== null) return swapBlock(html, Number(next.dataset.rev));

  const anchor = after === null ? null : findBlock(after);
  if (anchor !== null && grid.contains(anchor)) anchor.after(next);
  else grid.append(next);
  grid.closest('[data-stage]')?.removeAttribute('hidden');
  return next;
}
