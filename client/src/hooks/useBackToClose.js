import { useEffect, useRef } from 'react';

/**
 * Lets the browser / Android back button close a sheet or dialog instead of
 * leaving the page under it.
 *
 * While the overlay is open it owns one extra history entry (same URL, tagged
 * with its id). Back pops that entry and the overlay closes. When it closes
 * any other way (Cancel, a choice, Escape), the entry is popped for it, and
 * that pop is swallowed here so the page below does not react to it.
 *
 * Overlays can stack: each one only closes when its own entry is popped.
 */

let nextId = 0;
// Pops this module started itself (closing an overlay from the UI), which
// nothing else should see.
let ownPops = 0;
// Pushes waiting for those pops to land, so a new overlay's entry is not
// popped by the previous overlay's clean-up.
let waiting = [];

if (typeof window !== 'undefined') {
  // Registered once, before any component listener, in the capture phase.
  window.addEventListener('popstate', (event) => {
    if (ownPops === 0) return;
    ownPops -= 1;
    event.stopImmediatePropagation();
    if (ownPops === 0) {
      const run = waiting;
      waiting = [];
      run.forEach((fn) => fn());
    }
  }, true);
}

const whenSettled = (fn) => (ownPops === 0 ? fn() : waiting.push(fn));

/** Call inside an overlay component; `onClose` runs when back is pressed. */
export function useBackToClose(onClose) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const id = (nextId += 1);
    let mounted = true;
    let pushed = false;
    let closedByBack = false;

    whenSettled(() => {
      if (!mounted) return;
      window.history.pushState({ ...window.history.state, overlay: id }, '', window.location.href);
      pushed = true;
    });

    const onPop = () => {
      // Still on our entry (an overlay stacked above us was the one popped).
      if (!pushed || window.history.state?.overlay === id) return;
      closedByBack = true;
      close.current?.();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      mounted = false;
      window.removeEventListener('popstate', onPop);
      if (pushed && !closedByBack && window.history.state?.overlay === id) {
        ownPops += 1;
        window.history.back();
      }
    };
  }, []);
}
