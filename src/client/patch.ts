import { shouldApply } from '../shared/frames';
import { showOption } from './tabs';
import { showToast } from './toast';

export const SWAPPED_EVENT = 'pinpoint:swapped';

const UPDATED_CLASS = 'is-updated';
const UPDATED_FALLBACK_MS = 1200;
const ENTERING_CLASS = 'stage--entering';

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

function revealStage(stage: Element): void {
  if (!stage.hasAttribute('hidden')) return;
  stage.removeAttribute('hidden');
  stage.classList.add(ENTERING_CLASS);
  const clear = () => stage.classList.remove(ENTERING_CLASS);
  stage.addEventListener('animationend', clear, { once: true });
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
  const stage = grid.closest('[data-stage]');
  if (stage !== null) revealStage(stage);
  return next;
}

function answeredCount(block: Element | null): number {
  return block?.querySelectorAll('[data-state="answered"]').length ?? 0;
}

function isOutOfView(element: Element): boolean {
  if (element.getClientRects().length === 0) return true;
  const rect = element.getBoundingClientRect();
  return rect.bottom < 0 || rect.top > window.innerHeight;
}

function jumpTo(block: HTMLElement): void {
  if (block.matches('.block--option') && block.dataset.block !== undefined) showOption(block.dataset.block);
  const motionAllowed = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  block.scrollIntoView({ block: 'center', behavior: motionAllowed ? 'smooth' : 'auto' });
  block.focus({ preventScroll: true });
}

/** Swaps the block like `swapBlock`, and toasts when the swap added an answer to a block outside the viewport. */
export function swapBlockAnnouncingAnswer(html: string, rev: number): HTMLElement | null {
  const blockId = parseBlock(html)?.dataset.block;
  const before = blockId === undefined ? 0 : answeredCount(findBlock(blockId));
  const next = swapBlock(html, rev);
  if (next !== null && answeredCount(next) > before && isOutOfView(next)) {
    showToast(`Answer attached to ${next.dataset.label ?? 'a block'}`, () => jumpTo(next));
  }
  return next;
}
