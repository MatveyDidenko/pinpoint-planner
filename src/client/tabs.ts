import { optionTabRule } from '../shared/frames';

export const OPTION_SHOWN_EVENT = 'pinpoint:option-shown';

const TAB_SELECTOR = '.option-tab';

function allTabs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(TAB_SELECTOR));
}

export function showOption(optionId: string): void {
  const style = document.getElementById('option-tab-style');
  const tabs = allTabs();
  if (style === null || !tabs.some((tab) => tab.dataset.option === optionId)) return;
  style.textContent = optionTabRule(CSS.escape(optionId));
  for (const tab of tabs) {
    const selected = tab.dataset.option === optionId;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  document.dispatchEvent(new CustomEvent(OPTION_SHOWN_EVENT));
}

export function initTabs(): void {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const optionId = event.target.closest<HTMLElement>(TAB_SELECTOR)?.dataset.option;
    if (optionId !== undefined) showOption(optionId);
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(TAB_SELECTOR)) return;
    const tabs = allTabs();
    const at = tabs.indexOf(event.target);
    const moves: Record<string, number> = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: tabs.length - 1 };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = tabs[(move + tabs.length) % tabs.length];
    if (next?.dataset.option === undefined) return;
    showOption(next.dataset.option);
    next.focus();
  });
}
