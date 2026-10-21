/**
 * Locks the app after a stretch without use, so a phone left in the
 * staffroom does not stay open on the register. The offline PIN unlocks it
 * (auth/pin.js); the server sign-in underneath is not touched.
 *
 * The last activity is kept in localStorage, so closing the app and opening
 * it an hour later still asks for the PIN.
 */

export const INACTIVITY_LOCK_MS = 30 * 60 * 1000;

const KEY = 'smartattend:last-active';
// Writing on every tap is wasteful; this is plenty for a 30-minute lock.
const WRITE_EVERY_MS = 15 * 1000;

let lastWrite = 0;

export function markActive(now = Date.now(), { force = false } = {}) {
  if (!force && now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;
  try { localStorage.setItem(KEY, String(now)); } catch { /* private mode */ }
}

export function readLastActive() {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** True once INACTIVITY_LOCK_MS has passed since the last activity. No record counts as active. */
export function idleTooLong(now = Date.now(), limitMs = INACTIVITY_LOCK_MS) {
  const last = readLastActive();
  return last != null && now - last >= limitMs;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

/**
 * Track activity and call `onIdle` once the app has gone unused for the
 * limit: checked every 30 seconds, and straight away when the app comes
 * back to the foreground (a phone that slept for an hour).
 *
 * @returns {() => void} stop watching
 */
export function watchInactivity(onIdle, { limitMs = INACTIVITY_LOCK_MS, checkEveryMs = 30 * 1000 } = {}) {
  const active = () => markActive();
  const check = () => {
    if (idleTooLong(Date.now(), limitMs)) onIdle();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };

  markActive(Date.now(), { force: true });
  for (const name of ACTIVITY_EVENTS) window.addEventListener(name, active, { passive: true });
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(check, checkEveryMs);

  return () => {
    for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, active);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
