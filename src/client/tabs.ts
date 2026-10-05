import { optionTabName, optionTabRule, type TabDot } from '../shared/frames';

export const OPTION_SHOWN_EVENT = 'pinpoint:option-shown';

const TAB_SELECTOR = '.option-tab';

const unseenAnswers = new Set<string>();

function allTabs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(TAB_SELECTOR));
}

function refreshTab(tab: HTMLElement): void {
  const optionId = tab.dataset.option;
  if (optionId === undefined) return;
  const card = document.querySelector(`[data-block="${CSS.escape(optionId)}"]`);
  const selected = tab.getAttribute('aria-selected') === 'true';
  if (selected) unseenAnswers.delete(optionId);
  const waiting = card?.querySelector('[data-state="asked"], [data-state="delivered"]') ? 'waiting' : null;
  const dot: TabDot = selected ? null : unseenAnswers.has(optionId) ? 'answer' : waiting;
  const chosen = card?.hasAttribute('data-chosen') ?? false;
  if (dot === null) delete tab.dataset.dot;
  else tab.dataset.dot = dot;
  const chosenTag = tab.querySelector<HTMLElement>('.option-tab__chosen');
  if (chosenTag !== null) chosenTag.hidden = !chosen;
  const recommended = tab.querySelector('.option-tab__star') !== null;
  tab.setAttribute('aria-label', optionTabName({ label: tab.title, recommended, chosen, dot }));
}

export function refreshTabOf(optionId: string, answered = false): void {
  const tab = allTabs().find((candidate) => candidate.dataset.option === optionId);
  if (tab === undefined) return;
  if (answered) unseenAnswers.add(optionId);
  refreshTab(tab);
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
    refreshTab(tab);
  }
  document.dispatchEvent(new CustomEvent(OPTION_SHOWN_EVENT));
}

export function initTabs(): void {
  for (const tab of allTabs()) refreshTab(tab);

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
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
  });
}
