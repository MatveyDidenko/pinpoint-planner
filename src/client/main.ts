import type { Boot } from '../shared/frames';
import { initComposer } from './composer';
import { initConversations } from './conversation';
import { closeEditor, initDiagramEditor } from './diagram-editor';
import { connectLive } from './live';
import { postMessage } from './messages';
import { appendBlock, swapBlockAnnouncingAnswer } from './patch';
import { updatePresenceChip } from './presence-chip';
import { clearSelection, initChoose, initSelect, lockSelection } from './select';
import { initTabs } from './tabs';
import { initTheme, toggleTheme } from './theme';

initTheme();

document.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('[data-testid="theme-toggle"]')) toggleTheme();
});

let handedBack = false;

function lockBlockButtons(root: ParentNode | null): void {
  if (!handedBack || root === null) return;
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('.reply-btn, .edit-btn'))) {
    button.disabled = true;
  }
}

function askToHandBack(asking: boolean): void {
  const start = document.querySelector<HTMLButtonElement>('[data-action="hand-back"]');
  const confirm = document.querySelector<HTMLElement>('[data-testid="done-confirm"]');
  if (start === null || confirm === null) return;
  start.hidden = asking;
  confirm.hidden = !asking;
}

function setHandedBack(): void {
  handedBack = true;
  const done = document.querySelector<HTMLButtonElement>('[data-testid="done"]');
  if (done) done.disabled = true;
  askToHandBack(false);
  closeEditor(false);
  lockBlockButtons(document);
  lockSelection();
  clearSelection();
  updatePresenceChip({ presence: 'handed-back', undelivered: 0 });
}

function initDone(planId: string): void {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-action="hand-back"]:enabled')) {
      askToHandBack(true);
      document.querySelector<HTMLButtonElement>('[data-action="keep-reviewing"]')?.focus();
    }
    if (event.target.closest('[data-action="keep-reviewing"]')) {
      askToHandBack(false);
      document.querySelector<HTMLButtonElement>('[data-action="hand-back"]')?.focus();
    }
    const button = event.target.closest<HTMLButtonElement>('[data-action="done"]');
    if (button === null || button.disabled) return;
    button.disabled = true;
    postMessage(planId, { clientId: crypto.randomUUID(), kind: 'done', text: '' }).then(
      () => {
        setHandedBack();
        document.querySelector<HTMLElement>('[data-testid="presence"]')?.focus();
      },
      () => {
        button.disabled = false;
      },
    );
  });
}

const bootText = document.getElementById('pinpoint-boot')?.textContent;
if (bootText) {
  const boot = JSON.parse(bootText) as Boot;
  initSelect();
  initTabs();
  initChoose(boot.planId);
  initComposer(boot.planId);
  initConversations(boot.planId);
  initDiagramEditor(boot.planId);
  initDone(boot.planId);
  if (boot.review === 'handed-back') setHandedBack();
  connectLive(boot.planId, boot.revision, {
    hello: ({ presence, review }) => {
      if (review === 'handed-back') setHandedBack();
      else if (document.querySelector('[data-testid="presence"]')?.getAttribute('data-state') !== presence) {
        updatePresenceChip({ presence, undelivered: 0 });
      }
    },
    block: ({ html, rev }) => lockBlockButtons(swapBlockAnnouncingAnswer(html, rev)),
    appended: ({ html, after }) => lockBlockButtons(appendBlock(html, after)),
    presence: (frame) => {
      if (frame.presence === 'handed-back') setHandedBack();
      else updatePresenceChip(frame);
    },
    plan: () => location.reload(),
  });
}
