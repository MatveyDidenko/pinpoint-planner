const KEY_PREFIX = 'pinpoint:draft:';

export function draftKey(planId: string, blockId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(planId)}:${encodeURIComponent(blockId)}`;
}

export function loadDraft(planId: string, blockId: string): string {
  try {
    return sessionStorage.getItem(draftKey(planId, blockId)) ?? '';
  } catch {
    return '';
  }
}

export function clearDraft(planId: string, blockId: string): void {
  try {
    sessionStorage.removeItem(draftKey(planId, blockId));
  } catch {
    // Storage can be unavailable; the draft just does not persist.
  }
}

export function saveDraft(planId: string, blockId: string, text: string): void {
  if (text === '') {
    clearDraft(planId, blockId);
    return;
  }
  try {
    sessionStorage.setItem(draftKey(planId, blockId), text);
  } catch {
    // Storage can be unavailable; the draft just does not persist.
  }
}
