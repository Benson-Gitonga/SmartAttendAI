import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getGoogleSignInConfig } from '../../auth/session';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { Alert } from './AuthLayout';

/**
 * "Continue with Google" for school admins and teachers (never the system
 * admin). The server says how it is set up (GET /api/auth/google):
 *   google  Google's own button (Google Identity Services); the ID token it
 *           returns goes to the server, which checks it and finds the account.
 *   dev     no GOOGLE_CLIENT_ID on the server yet: a stand-in that asks for the
 *           Google email, so the flow works before a Google Cloud project exists.
 *   off     hidden.
 * Google only signs in to an account its Google account was linked to. Linking
 * happens from an invite or set-up link, or from the account sheet: pass
 * `action` to send the credential there instead of signing in.
 *
 * @param {string} [email]   the address the account uses, when the page knows it
 * @param {(credential: string) => Promise<unknown>} [action]  default: sign in
 * @param {boolean} [divider]  show "or" above the button
 * @param {() => void} [onSignedIn]  after `action` succeeds
 */
export default function GoogleSignInButton({ disabled = false, email = '', action, divider = true, onSignedIn }) {
  const { signInWithGoogle } = useAuth();
  const online = useOnlineStatus();
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!online) return undefined;
    let cancelled = false;
    getGoogleSignInConfig().then((c) => { if (!cancelled) setConfig(c); });
    return () => { cancelled = true; };
  }, [online]);

  async function submit(credential) {
    setError(null);
    setBusy(true);
    try {
      await (action ?? signInWithGoogle)(credential);
      setBusy(false);
      onSignedIn?.();
    } catch (err) {
      setError(err.message ?? 'Google sign-in did not work.');
      setBusy(false);
    }
  }

  if (!config || config.mode === 'off') return null;
  const off = disabled || busy || !online;

  return (
    <>
      {divider && <div className="pub-divider"><span>or</span></div>}
      {error && <Alert>{error}</Alert>}
      {config.mode === 'google'
        ? <GoogleButton clientId={config.clientId} disabled={off} onCredential={submit} />
        : <DevGoogleSignIn email={email} disabled={off} busy={busy} onCredential={submit} />}
    </>
  );
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisLoading = null;
function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve(window.google);
      script.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(script);
    });
  }
  return gisLoading;
}

/** Google's own button, drawn by Google Identity Services into the box. */
function GoogleButton({ clientId, disabled, onCredential }) {
  const box = useRef(null);
  const callback = useRef(onCredential);
  useEffect(() => { callback.current = onCredential; }, [onCredential]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !box.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callback.current(response.credential),
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        google.accounts.id.renderButton(box.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          width: Math.max(200, Math.min(400, box.current.offsetWidth || 320)),
        });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (failed) return <Alert tone="warn">Google sign-in could not load. Check your connection, or sign in with your password.</Alert>;
  return <div ref={box} className={`pub-google${disabled ? ' pub-google--disabled' : ''}`} aria-disabled={disabled} />;
}

/** Development stand-in: asks which Google email to sign in as. */
function DevGoogleSignIn({ email: knownEmail, disabled, busy, onCredential }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(knownEmail);

  if (!open) {
    return (
      <button type="button" className="pub-btn pub-btn--google pub-btn--block" disabled={disabled} onClick={() => setOpen(true)}>
        <GoogleLogo /> Continue with Google
      </button>
    );
  }
  return (
    <div className="pub-devgoogle">
      <p className="pub-devgoogle__note">
        <b>Development mode.</b> The server has no <code>GOOGLE_CLIENT_ID</code> yet, so Google is simulated:
        enter the Google account’s email.
      </p>
      <div className="pub-devgoogle__row">
        <input
          className="pub-input"
          type="email"
          aria-label="Google email"
          placeholder="name@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (email.includes('@')) onCredential(`dev:${email.trim()}`); } }}
          disabled={disabled}
          autoFocus
        />
        <button
          type="button"
          className="pub-btn pub-btn--google"
          disabled={disabled || !email.includes('@')}
          onClick={() => onCredential(`dev:${email.trim()}`)}
        >
          <GoogleLogo /> {busy ? 'Signing in…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
