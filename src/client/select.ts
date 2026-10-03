import { captureExcerpt } from './excerpt';

export const SELECTED_EVENT = 'pinpoint:selected';

export type SelectedDetail = { blockId: string | null; excerpt?: string };

const BLOCK_SELECTOR = '[data-block]';
const SELECTED_SELECTOR = '[data-block][data-selected]';

export function isActionTarget(el: Element): boolean {
  const control = el.closest('[data-action], a, button, textarea, input');
  return control !== null && !control.matches('[data-action="ask"]');
}

const selectedElements = () => Array.from(document.querySelectorAll(SELECTED_SELECTOR));

export function selectedBlock(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTED_SELECTOR);
}

function announce(detail: SelectedDetail): void {
  document.dispatchEvent(new CustomEvent<SelectedDetail>(SELECTED_EVENT, { detail }));
}

export function selectBlock(block: HTMLElement, clickTarget: Element | null = null): void {
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

function composerHasDraft(): boolean {
  const input = document.querySelector<HTMLTextAreaElement>('#composer textarea');
  return input !== null && input.value !== '';
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
    if (!composerHasDraft()) clearSelection();
  });
}
