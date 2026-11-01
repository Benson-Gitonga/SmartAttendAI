import { useEffect } from 'react';

/** Keep the screen on while `active`, for a phone left scanning at a gate. */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined;
    let lock = null;
    let released = false;
    const request = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (released) next.release();
        else lock = next;
      } catch { /* refused, e.g. low battery: the screen just sleeps as usual */ }
    };
    request();
    // The browser drops the lock whenever the page is hidden.
    document.addEventListener('visibilitychange', request);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', request);
      lock?.release();
    };
  }, [active]);
}
