import type { EditGraph } from './graph-model';

function storageKey(kind: string, planId: string, blockId: string): string {
  return `pinpoint:${kind}:${encodeURIComponent(planId)}:${encodeURIComponent(blockId)}`;
}

export function draftKey(planId: string, blockId: string): string {
  return storageKey('draft', planId, blockId);
}

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeStored(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable; there is then nothing stored to clear.
  }
}

function writeStored(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the value just does not persist.
  }
}

export function loadDraft(planId: string, blockId: string): string {
  return readStored(draftKey(planId, blockId)) ?? '';
}

export function clearDraft(planId: string, blockId: string): void {
  removeStored(draftKey(planId, blockId));
}

export function saveDraft(planId: string, blockId: string, text: string): void {
  if (text === '') clearDraft(planId, blockId);
  else writeStored(draftKey(planId, blockId), text);
}

function editsOn(raw: string, base: EditGraph): EditGraph | null {
  try {
    const stored: { base?: EditGraph; graph?: EditGraph } = JSON.parse(raw);
    const { graph } = stored;
    if (graph === undefined || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
    return JSON.stringify(stored.base) === JSON.stringify(base) ? graph : null;
  } catch {
    return null;
  }
}

/** Restores edits saved on top of `base`, discarding any saved on a diagram that has changed since. */
export function loadDiagram(planId: string, blockId: string, base: EditGraph): EditGraph | null {
  const key = storageKey('diagram', planId, blockId);
  const raw = readStored(key);
  const graph = raw === null ? null : editsOn(raw, base);
  if (raw !== null && graph === null) removeStored(key);
  return graph;
}

export function saveDiagram(planId: string, blockId: string, base: EditGraph, graph: EditGraph): void {
  writeStored(storageKey('diagram', planId, blockId), JSON.stringify({ base, graph }));
}

export function clearDiagram(planId: string, blockId: string): void {
  removeStored(storageKey('diagram', planId, blockId));
}

export function loadConversationHidden(planId: string, blockId: string): boolean {
  return readStored(storageKey('conversation', planId, blockId)) === 'hidden';
}

export function saveConversationHidden(planId: string, blockId: string, hidden: boolean): void {
  const key = storageKey('conversation', planId, blockId);
  if (hidden) writeStored(key, 'hidden');
  else removeStored(key);
}
