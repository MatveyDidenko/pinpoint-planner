import type { BrowserMessage } from '../core/schema';
import { DIAGRAM_CHANGED_EVENT, editedProposal, editedSketch, finishProposal, hasSketch } from './diagram-editor';
import { clearDraft, loadDraft, saveDraft } from './draft';
import { postMessage, UNREACHABLE_MESSAGE } from './messages';
import { SWAPPED_EVENT } from './patch';
import { clearSelection, SELECTED_EVENT, type SelectedDetail, selectBlock, selectedBlock } from './select';
import { OPTION_SHOWN_EVENT } from './tabs';

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
  const versionChip = document.createElement('p');
  versionChip.className = 'composer-chip';
  versionChip.setAttribute('data-testid', 'composer-proposal');
  versionChip.hidden = true;
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
  root.replaceChildren(head, versionChip, input, hint, sendButton);

  let openBlockId: string | null = null;
  let openThreadId: string | null = null;
  let versionBlockId: string | null = null;
  let excerpt: string | undefined;
  let excerptEl: HTMLParagraphElement | null = null;
  let sending = false;

  const draftId = () => (openThreadId === null ? openBlockId : `${openBlockId}:${openThreadId}`);

  const anchor = (): HTMLElement | null => {
    if (openThreadId !== null) return document.querySelector(`.thread[data-thread="${CSS.escape(openThreadId)}"]`);
    const block = selectedBlock();
    return block !== null && block.dataset.block === openBlockId ? block : null;
  };

  const position = () => {
    const target = anchor();
    if (target === null) return;
    const page = root.offsetParent;
    const pageTop = page === null ? 0 : page.getBoundingClientRect().top;
    root.style.top = `${target.getBoundingClientRect().bottom - pageTop + GAP_PX}px`;
  };

  const showVersion = () => {
    const versionId =
      openBlockId !== null && openThreadId === null && versionBlockId === openBlockId ? openBlockId : null;
    const edited = versionId === null ? null : editedProposal(versionId);
    const drawn = versionId !== null && hasSketch(versionId);
    const changes = edited === null ? '' : ` · ${edited.changes} change${edited.changes === 1 ? '' : 's'}`;
    versionChip.hidden = edited === null && !drawn;
    versionChip.textContent =
      edited === null
        ? drawn
          ? 'With your drawing'
          : ''
        : `With your edited diagram${drawn ? ' and drawing' : ''}${changes}`;
    return { edited, drawn };
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
    openThreadId = null;
    versionBlockId = null;
    showVersion();
    showExcerpt(undefined);
    root.hidden = true;
    input.value = '';
    hint.textContent = DEFAULT_HINT;
  };

  const open = (block: HTMLElement, text: string | undefined, threadId: string | null = null) => {
    const previous = draftId();
    openBlockId = block.dataset.block ?? null;
    openThreadId = openBlockId === null ? null : threadId;
    const next = draftId();
    if (next !== previous) {
      input.value = next === null ? '' : loadDraft(planId, next);
      hint.textContent = DEFAULT_HINT;
    }
    const label = block.dataset.label ?? openBlockId ?? '';
    head.textContent = openThreadId === null ? `ASK ABOUT ${label}` : `REPLY · ${label}`;
    showExcerpt(text);
    showVersion();
    root.hidden = false;
    position();
    input.focus();
  };

  const send = async () => {
    const text = input.value.trim();
    const draft = draftId();
    const blockId = openBlockId;
    if (text === '' || blockId === null || draft === null || sending) return;
    const { edited, drawn } = showVersion();
    const threadId = openThreadId;
    const quoted = excerpt;
    sending = true;
    sendButton.disabled = true;
    try {
      const sketch = drawn ? await editedSketch(blockId) : null;
      const message: BrowserMessage = {
        clientId: crypto.randomUUID(),
        kind: 'ask',
        blockId,
        text,
        ...(quoted === undefined ? {} : { excerpt: quoted }),
        ...(threadId === null ? {} : { threadId }),
        ...(edited === null ? {} : { proposal: edited.proposal }),
        ...(sketch === null ? {} : { sketch }),
      };
      await postMessage(planId, message);
      clearDraft(planId, draft);
      if (edited !== null || sketch !== null) finishProposal(blockId);
      clearSelection();
    } catch (error) {
      hint.textContent = error instanceof Error ? error.message : UNREACHABLE_MESSAGE;
    } finally {
      sending = false;
      sendButton.disabled = false;
    }
  };

  input.addEventListener('input', () => {
    const draft = draftId();
    if (draft !== null) saveDraft(planId, draft, input.value);
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

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-action="reply"]');
    const block = button?.closest<HTMLElement>('[data-block]') ?? null;
    const threadId = button?.dataset.thread;
    if (button === null || button.disabled || block === null || threadId === undefined) return;
    clearSelection();
    open(block, undefined, threadId);
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const block = event.target.closest('[data-action="ask-version"]')?.closest<HTMLElement>('[data-block]');
    if (block === null || block === undefined) return;
    selectBlock(block);
    versionBlockId = block.dataset.block ?? null;
    showVersion();
  });

  document.addEventListener(DIAGRAM_CHANGED_EVENT, showVersion);

  document.addEventListener(SELECTED_EVENT, (event) => {
    const { blockId, excerpt: picked } = (event as CustomEvent<SelectedDetail>).detail;
    const block = blockId === null ? null : selectedBlock();
    if (block === null) close();
    else open(block, picked);
  });

  document.addEventListener(OPTION_SHOWN_EVENT, () => {
    const target = anchor();
    if (openBlockId !== null && (target === null || target.getClientRects().length === 0)) clearSelection();
  });

  document.addEventListener(SWAPPED_EVENT, (event) => {
    const { blockId } = (event as CustomEvent<{ blockId: string }>).detail;
    if (blockId === openBlockId) position();
  });

  window.addEventListener('resize', position);
}
