import type { BrowserMessage } from '../core/schema';
import { clearDraft, loadDraft, saveDraft } from './draft';
import { postMessage, UNREACHABLE_MESSAGE } from './messages';
import { SWAPPED_EVENT } from './patch';
import { clearSelection, SELECTED_EVENT, type SelectedDetail, selectedBlock } from './select';

export type ComposerKeyAction = 'send' | 'newline' | 'close' | 'none';

const DEFAULT_HINT = 'Enter to send · Shift+Enter for a new line · Esc to close';
const GAP_PX = 10;

export function composerKeyAction(
  event: { key: string; shiftKey: boolean; isComposing: boolean },
  textEmpty: boolean,
): ComposerKeyAction {
  if (event.isComposing) return 'none';
  if (event.key === 'Enter') return event.shiftKey ? 'newline' : 'send';
  if (event.key === 'Escape' && textEmpty) return 'close';
  return 'none';
}

export function initComposer(planId: string): void {
  const root = document.getElementById('composer');
  if (root === null) return;

  const head = document.createElement('p');
  head.className = 'composer-head';
  const input = document.createElement('textarea');
  input.setAttribute('data-testid', 'composer-input');
  input.setAttribute('aria-label', 'Your question');
  input.rows = 3;
  const hint = document.createElement('span');
  hint.className = 'composer-hint';
  hint.textContent = DEFAULT_HINT;
  const sendButton = document.createElement('button');
  sendButton.type = 'button';
  sendButton.className = 'composer-send';
  sendButton.setAttribute('data-testid', 'composer-send');
  sendButton.textContent = 'Send';
  root.replaceChildren(head, input, hint, sendButton);

  let openBlockId: string | null = null;
  let excerpt: string | undefined;
  let excerptEl: HTMLParagraphElement | null = null;
  let sending = false;

  const position = (block: HTMLElement) => {
    const page = root.offsetParent;
    const pageTop = page === null ? 0 : page.getBoundingClientRect().top;
    root.style.top = `${block.getBoundingClientRect().bottom - pageTop + GAP_PX}px`;
  };

  const showExcerpt = (text: string | undefined) => {
    excerpt = text;
    excerptEl?.remove();
    excerptEl = null;
    if (text === undefined) return;
    excerptEl = document.createElement('p');
    excerptEl.className = 'composer-excerpt';
    excerptEl.textContent = text;
    head.after(excerptEl);
  };

  const close = () => {
    openBlockId = null;
    showExcerpt(undefined);
    root.hidden = true;
    input.value = '';
    hint.textContent = DEFAULT_HINT;
  };

  const open = (block: HTMLElement, text: string | undefined) => {
    const blockId = block.dataset.block ?? null;
    if (blockId !== openBlockId) {
      input.value = blockId === null ? '' : loadDraft(planId, blockId);
      hint.textContent = DEFAULT_HINT;
    }
    openBlockId = blockId;
    head.textContent = `ASK ABOUT ${block.dataset.label ?? blockId ?? ''}`;
    showExcerpt(text);
    root.hidden = false;
    position(block);
    input.focus();
  };

  const send = async () => {
    const text = input.value.trim();
    if (text === '' || openBlockId === null || sending) return;
    const blockId = openBlockId;
    const message: BrowserMessage = {
      clientId: crypto.randomUUID(),
      kind: 'ask',
      blockId,
      text,
      ...(excerpt === undefined ? {} : { excerpt }),
    };
    sending = true;
    sendButton.disabled = true;
    try {
      await postMessage(planId, message);
      clearDraft(planId, blockId);
      clearSelection();
    } catch (error) {
      hint.textContent = error instanceof Error ? error.message : UNREACHABLE_MESSAGE;
    } finally {
      sending = false;
      sendButton.disabled = false;
    }
  };

  input.addEventListener('input', () => {
    if (openBlockId !== null) saveDraft(planId, openBlockId, input.value);
    hint.textContent = DEFAULT_HINT;
  });

  input.addEventListener('keydown', (event) => {
    const action = composerKeyAction(event, input.value === '');
    if (action === 'none' || action === 'newline') return;
    event.preventDefault();
    if (action === 'send') void send();
    else clearSelection();
  });

  sendButton.addEventListener('click', () => void send());

  document.addEventListener(SELECTED_EVENT, (event) => {
    const { blockId, excerpt: picked } = (event as CustomEvent<SelectedDetail>).detail;
    const block = blockId === null ? null : selectedBlock();
    if (block === null) close();
    else open(block, picked);
  });

  document.addEventListener(SWAPPED_EVENT, (event) => {
    const { blockId } = (event as CustomEvent<{ blockId: string }>).detail;
    const block = selectedBlock();
    if (block !== null && block.dataset.block === blockId && openBlockId === blockId) position(block);
  });

  window.addEventListener('resize', () => {
    const block = selectedBlock();
    if (block !== null && openBlockId !== null) position(block);
  });
}
