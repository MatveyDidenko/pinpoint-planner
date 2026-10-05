// Mirrors EXCERPT_MAX from core/schema; importing it would bundle zod into the browser.
export const EXCERPT_LIMIT = 200;

const QUOTABLE_SELECTOR = '[data-node-label], [data-excerpt]';

const tidy = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

export function excerptFrom(selectionText: string | null, quotable: string | null, max: number): string | undefined {
  const text = tidy(selectionText) || tidy(quotable);
  const capped = text.slice(0, max).trimEnd();
  return capped === '' ? undefined : capped;
}

function selectionInside(blockEl: Element): string | null {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed) return null;
  const { anchorNode, focusNode } = selection;
  if (anchorNode === null || focusNode === null) return null;
  return blockEl.contains(anchorNode) && blockEl.contains(focusNode) ? selection.toString() : null;
}

export function captureExcerpt(blockEl: Element, clickTarget: Element | null): string | undefined {
  const quoted = clickTarget?.closest(QUOTABLE_SELECTOR) ?? null;
  const text =
    quoted !== null && blockEl.contains(quoted)
      ? (quoted.getAttribute('data-node-label') ?? quoted.getAttribute('data-excerpt'))
      : null;
  return excerptFrom(selectionInside(blockEl), text, EXCERPT_LIMIT);
}
