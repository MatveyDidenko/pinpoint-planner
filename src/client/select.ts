import { captureExcerpt } from './excerpt';
import { postMessage, UNREACHABLE_MESSAGE } from './messages';

export const SELECTED_EVENT = 'pinpoint:selected';

export type SelectedDetail = { blockId: string | null; excerpt?: string };

const BLOCK_SELECTOR = '[data-block]';
const SELECTED_SELECTOR = '[data-block][data-selected]';

export function isActionTarget(el: Element): boolean {
  return el.closest('[data-action], a, button, textarea, input, summary, #composer') !== null;
}

let selectionLocked = false;

export function lockSelection(): void {
  selectionLocked = true;
}

const selectedElements = () => Array.from(document.querySelectorAll(SELECTED_SELECTOR));

export function selectedBlock(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTED_SELECTOR);
}

function announce(detail: SelectedDetail): void {
  document.dispatchEvent(new CustomEvent<SelectedDetail>(SELECTED_EVENT, { detail }));
}

export function selectBlock(block: HTMLElement, clickTarget: Element | null = null): void {
  if (selectionLocked) return;
  for (const other of selectedElements()) {
    if (other !== block) other.removeAttribute('data-selected');
  }
  block.setAttribute('data-selected', '');
  const excerpt = captureExcerpt(block, clickTarget);
  announce({ blockId: block.dataset.block ?? null, ...(excerpt === undefined ? {} : { excerpt }) });
}

export function clearSelection(): void {
  for (const block of selectedElements()) block.removeAttribute('data-selected');
  announce({ blockId: null });
}

function isBlockEnter(event: KeyboardEvent): event is KeyboardEvent & { target: HTMLElement } {
  const { target } = event;
  const plain = !(event.shiftKey || event.ctrlKey || event.altKey || event.metaKey);
  return (
    event.key === 'Enter' &&
    plain &&
    !event.isComposing &&
    !event.defaultPrevented &&
    target instanceof HTMLElement &&
    target.matches(BLOCK_SELECTOR)
  );
}

export function initSelect(): void {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const block = event.target.closest<HTMLElement>(BLOCK_SELECTOR);
    if (block === null || isActionTarget(event.target)) return;
    selectBlock(block, event.target);
  });

  document.addEventListener('keydown', (event) => {
    if (isBlockEnter(event)) {
      event.preventDefault();
      selectBlock(event.target);
      return;
    }
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('#composer')) return;
    clearSelection();
  });
}

function showChooseError(button: HTMLButtonElement, text: string): void {
  const note = document.createElement('span');
  note.className = 'choose-note';
  note.setAttribute('role', 'alert');
  note.setAttribute('data-error', '');
  note.setAttribute('data-testid', `${button.getAttribute('data-testid') ?? 'choose'}-error`);
  note.textContent = text;
  button.after(note);
}

export function initChoose(planId: string): void {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-action="choose"]');
    const optionId = button?.closest<HTMLElement>(BLOCK_SELECTOR)?.dataset.block;
    if (button === null || button.disabled || optionId === undefined) return;
    button.disabled = true;
    button.nextElementSibling?.remove();
    postMessage(planId, { clientId: crypto.randomUUID(), kind: 'choose', blockId: optionId, optionId, text: '' }).catch(
      (error: unknown) => {
        button.disabled = false;
        showChooseError(button, error instanceof Error ? error.message : UNREACHABLE_MESSAGE);
      },
    );
  });
}
