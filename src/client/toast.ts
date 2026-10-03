const TOAST_MS = 6000;

let dismissTimer: ReturnType<typeof setTimeout> | undefined;

function hideToast(toast: HTMLElement): void {
  clearTimeout(dismissTimer);
  toast.hidden = true;
  toast.replaceChildren();
}

export function showToast(text: string, onJump: () => void): void {
  const toast = document.getElementById('toast');
  if (toast === null) return;
  clearTimeout(dismissTimer);

  const message = document.createElement('span');
  message.textContent = `${text} ·`;
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'toast-jump';
  jump.setAttribute('data-testid', 'toast-jump');
  jump.textContent = 'Jump';
  jump.addEventListener('click', () => {
    onJump();
    hideToast(toast);
  });

  toast.replaceChildren(message, jump);
  toast.hidden = false;
  dismissTimer = setTimeout(() => hideToast(toast), TOAST_MS);
}
