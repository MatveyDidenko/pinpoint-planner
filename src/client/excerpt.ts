// Mirrors EXCERPT_MAX from core/schema; importing it would bundle zod into the browser.
export const EXCERPT_LIMIT = 200;

const NODE_LABEL_SELECTOR = '[data-node-label]';

const tidy = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

export function excerptFrom(selectionText: string | null, nodeLabel: string | null, max: number): string | undefined {
  const text = tidy(selectionText) || tidy(nodeLabel);
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
  const node = clickTarget?.closest(NODE_LABEL_SELECTOR) ?? null;
  const label = node !== null && blockEl.contains(node) ? node.getAttribute('data-node-label') : null;
  return excerptFrom(selectionInside(blockEl), label, EXCERPT_LIMIT);
}
