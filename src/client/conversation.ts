import { loadConversationHidden, saveConversationHidden } from './draft';
import { SWAPPED_EVENT } from './patch';
import { clearSelection } from './select';

function showConversation(block: Element, shown: boolean): void {
  const toggle = block.querySelector<HTMLButtonElement>(':scope > [data-action="toggle-qa"]');
  const qa = block.querySelector<HTMLElement>(':scope > .qa');
  if (toggle === null || qa === null) return;
  qa.hidden = !shown;
  toggle.setAttribute('aria-expanded', String(shown));
  toggle.textContent = `${shown ? 'Hide' : 'Show'} conversation (${toggle.dataset.count ?? 0})`;
}

export function revealConversation(planId: string, blockId: string): void {
  saveConversationHidden(planId, blockId, false);
  const block = document.querySelector(`[data-block="${CSS.escape(blockId)}"]`);
  if (block !== null) showConversation(block, true);
}

export function initConversations(planId: string): void {
  const restore = (block: HTMLElement | null) => {
    const blockId = block?.dataset.block;
    if (block && blockId !== undefined && loadConversationHidden(planId, blockId)) showConversation(block, false);
  };
  for (const block of Array.from(document.querySelectorAll<HTMLElement>('[data-block]'))) restore(block);

  document.addEventListener(SWAPPED_EVENT, (event) => {
    const { blockId } = (event as CustomEvent<{ blockId: string }>).detail;
    restore(document.querySelector<HTMLElement>(`[data-block="${CSS.escape(blockId)}"]`));
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const toggle = event.target.closest('[data-action="toggle-qa"]');
    const block = toggle?.closest<HTMLElement>('[data-block]');
    const blockId = block?.dataset.block;
    if (!toggle || !block || blockId === undefined) return;
    const shown = toggle.getAttribute('aria-expanded') !== 'true';
    showConversation(block, shown);
    saveConversationHidden(planId, blockId, !shown);
    if (!shown && block.querySelector('.qa #composer:not([hidden])')) clearSelection();
  });
}
