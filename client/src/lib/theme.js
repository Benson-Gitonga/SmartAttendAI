/**
 * Light / dark theme. The choice is 'system' | 'light' | 'dark', saved per
 * device, and light until the user picks otherwise. 'system' removes the
 * attribute so the CSS follows the OS setting;
 * the other two set <html data-theme>. index.html applies the saved choice
 * before first paint so the page never flashes the wrong theme.
 */
import { useEffect, useState } from 'react';

export const THEME_KEY = 'smartattend:theme';
export const THEMES = ['system', 'light', 'dark'];
const EVENT = 'smartattend:theme';

export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : 'light';
  } catch {
    return 'light';
  }
}

/** The theme actually showing, after resolving 'system'. */
export function resolvedTheme(choice = getTheme()) {
  if (choice !== 'system') return choice;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(choice = getTheme()) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolvedTheme(choice) === 'dark' ? '#1e1f22' : '#f6f7f9');
}

export function setTheme(choice) {
  if (!THEMES.includes(choice)) return;
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* private mode: still apply for this page */ }
  applyTheme(choice);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: choice }));
}

/** [choice, setTheme]; every toggle on the page stays in step. */
export function useTheme() {
  const [choice, setChoice] = useState(getTheme);
  const [, setOsTick] = useState(0);
  useEffect(() => {
    const onChange = () => setChoice(getTheme());
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    // No choice saved yet: follow the device, and re-render so the toggle shows it.
    const onOs = () => {
      if (getTheme() !== 'system') return;
      applyTheme('system');
      setOsTick((n) => n + 1);
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    mq?.addEventListener?.('change', onOs);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
      mq?.removeEventListener?.('change', onOs);
    };
  }, []);
  return [choice, setTheme];
}
