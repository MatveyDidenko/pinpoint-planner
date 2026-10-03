import type { Boot } from '../shared/frames';
import { connectLive } from './live';
import { appendBlock, swapBlock } from './patch';
import { initTheme, toggleTheme } from './theme';

initTheme();

document.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('[data-testid="theme-toggle"]')) toggleTheme();
});

const bootText = document.getElementById('pinpoint-boot')?.textContent;
if (bootText) {
  const boot = JSON.parse(bootText) as Boot;
  connectLive(boot.planId, boot.revision, {
    block: ({ html, rev }) => swapBlock(html, rev),
    appended: ({ html, after }) => appendBlock(html, after),
    plan: () => location.reload(),
  });
}
