import type { Boot } from '../shared/frames';
import { initComposer } from './composer';
import { initDiagramEditor } from './diagram-editor';
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

function setHandedBack(): void {
  const done = document.querySelector<HTMLButtonElement>('[data-testid="done"]');
  if (done) done.disabled = true;
  for (const reply of Array.from(document.querySelectorAll<HTMLButtonElement>('.reply-btn'))) reply.disabled = true;
  lockSelection();
  clearSelection();
  updatePresenceChip({ presence: 'handed-back', undelivered: 0 });
}

function initDone(planId: string): void {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-action="done"]');
    if (button === null || button.disabled) return;
    button.disabled = true;
    postMessage(planId, { clientId: crypto.randomUUID(), kind: 'done', text: '' }).then(setHandedBack, () => {
      button.disabled = false;
    });
  });
}

const bootText = document.getElementById('pinpoint-boot')?.textContent;
if (bootText) {
  const boot = JSON.parse(bootText) as Boot;
  initSelect();
  initTabs();
  initChoose(boot.planId);
  initComposer(boot.planId);
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
    block: ({ html, rev }) => swapBlockAnnouncingAnswer(html, rev),
    appended: ({ html, after }) => appendBlock(html, after),
    presence: (frame) => {
      if (frame.presence === 'handed-back') setHandedBack();
      else updatePresenceChip(frame);
    },
    plan: () => location.reload(),
  });
}
