const TOAST_MS = 6000;

let dismissTimer: ReturnType<typeof setTimeout> | undefined;
let paused = false;
let pausable = false;

function hideToast(toast: HTMLElement): void {
  clearTimeout(dismissTimer);
  toast.hidden = true;
  toast.replaceChildren();
}

function scheduleHide(toast: HTMLElement): void {
  clearTimeout(dismissTimer);
  if (!paused) dismissTimer = setTimeout(() => hideToast(toast), TOAST_MS);
}

function pauseWhileInside(toast: HTMLElement): void {
  if (pausable) return;
  pausable = true;
  const pause = () => {
    paused = true;
    clearTimeout(dismissTimer);
  };
  const resume = (event: PointerEvent | FocusEvent) => {
    if (event instanceof FocusEvent && event.relatedTarget instanceof Node && toast.contains(event.relatedTarget))
      return;
    paused = false;
    scheduleHide(toast);
  };
  toast.addEventListener('pointerenter', pause);
  toast.addEventListener('focusin', pause);
  toast.addEventListener('pointerleave', resume);
  toast.addEventListener('focusout', resume);
}

export function showToast(text: string, onJump: () => void): void {
  const toast = document.getElementById('toast');
  if (toast === null) return;
  pauseWhileInside(toast);

  const message = document.createElement('span');
  message.textContent = text;
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'toast-jump';
  jump.setAttribute('data-testid', 'toast-jump');
  jump.textContent = 'Show';
  jump.addEventListener('click', () => {
    onJump();
    paused = false;
    hideToast(toast);
  });

  toast.replaceChildren(message, jump);
  toast.hidden = false;
  scheduleHide(toast);
}
