import { useEffect, useState } from 'react';

/**
 * Lets the page offer "Install the app". Chrome and Edge fire
 * beforeinstallprompt once, often before React has drawn anything, so the
 * event is caught here at start-up and kept until a button asks for it.
 * Safari on iPhone has no such event; there the user adds the app from the
 * Share menu, so the button explains that instead.
 */

let deferred = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, so also check for touch.
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  // Other iPhone browsers (CriOS, FxiOS, EdgiOS) can't add to the home screen the same way.
  return ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function listenForInstallPrompt() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep Chrome's own mini-bar away; we show our button
    deferred = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** 'prompt' | 'ios' | null (nothing to offer: already installed or unsupported). */
function currentMode() {
  if (installed || isStandalone()) return null;
  if (deferred) return 'prompt';
  if (isIosSafari()) return 'ios';
  return null;
}

export function useInstallPrompt() {
  const [mode, setMode] = useState(currentMode);

  useEffect(() => {
    const update = () => setMode(currentMode());
    listeners.add(update);
    update();
    return () => { listeners.delete(update); };
  }, []);

  const install = async () => {
    if (!deferred) return 'unavailable';
    const event = deferred;
    deferred = null; // a prompt can only be shown once
    event.prompt();
    const { outcome } = await event.userChoice;
    notify();
    return outcome; // 'accepted' | 'dismissed'
  };

  return { mode, install };
}
