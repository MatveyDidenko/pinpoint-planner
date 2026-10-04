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

export function loadDiagram(planId: string, blockId: string): EditGraph | null {
  const raw = readStored(storageKey('diagram', planId, blockId));
  if (raw === null) return null;
  try {
    const graph: EditGraph = JSON.parse(raw);
    return Array.isArray(graph.nodes) && Array.isArray(graph.edges) ? graph : null;
  } catch {
    return null;
  }
}

export function saveDiagram(planId: string, blockId: string, graph: EditGraph): void {
  writeStored(storageKey('diagram', planId, blockId), JSON.stringify(graph));
}

export function clearDiagram(planId: string, blockId: string): void {
  removeStored(storageKey('diagram', planId, blockId));
}
