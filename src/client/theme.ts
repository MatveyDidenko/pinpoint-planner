export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pinpoint-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

export function nextTheme(current: Theme | null, prefersDark: boolean): Theme {
  const effective = current ?? (prefersDark ? 'dark' : 'light');
  return effective === 'dark' ? 'light' : 'dark';
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function currentTheme(): Theme | null {
  const attribute = document.documentElement.getAttribute('data-theme');
  return isTheme(attribute) ? attribute : null;
}

function labelToggle(): void {
  const toggle = document.querySelector('[data-testid="theme-toggle"]');
  if (toggle === null) return;
  const next = nextTheme(currentTheme(), window.matchMedia(DARK_QUERY).matches);
  toggle.textContent = next === 'dark' ? 'Dark' : 'Light';
  toggle.setAttribute('aria-label', `Switch to ${next} theme`);
}

export function initTheme(): void {
  const stored = storedTheme();
  if (stored !== null) document.documentElement.setAttribute('data-theme', stored);
  labelToggle();
  window.matchMedia(DARK_QUERY).addEventListener('change', labelToggle);
}

export function toggleTheme(): Theme {
  const next = nextTheme(currentTheme(), window.matchMedia(DARK_QUERY).matches);
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable; the attribute still applies for this page load.
  }
  labelToggle();
  return next;
}
