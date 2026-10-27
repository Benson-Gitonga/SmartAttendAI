import { useEffect, useState } from 'react';
import { getGoogleSignInConfig, setLinkedGoogle } from '../auth/session';
import { getMyAccount } from '../services/accountService';
import GoogleSignInButton from './auth/GoogleSignInButton';

/**
 * Account sheet row for "Continue with Google": shows the linked Google
 * account with Unlink, or Google's button to link one. Hidden offline and
 * when the server has Google sign-in off.
 */
export default function GoogleLinkRow({ online }) {
  const [enabled, setEnabled] = useState(false);
  const [googleEmail, setGoogleEmail] = useState(undefined); // undefined: not loaded yet
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!online) return undefined;
    let cancelled = false;
    (async () => {
      const config = await getGoogleSignInConfig();
      if (cancelled || config.mode === 'off') return;
      setEnabled(true);
      const account = await getMyAccount().catch(() => null);
      if (!cancelled && account) setGoogleEmail(account.user.googleEmail ?? null);
    })();
    return () => { cancelled = true; };
  }, [online]);

  if (!online || !enabled || googleEmail === undefined) return null;

  async function link(credential) {
    const account = await setLinkedGoogle(credential);
    setGoogleEmail(account.user.googleEmail ?? null);
    setLinking(false);
  }

  async function unlink() {
    setError(null);
    setBusy(true);
    try {
      const account = await setLinkedGoogle(null);
      setGoogleEmail(account.user.googleEmail ?? null);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="account-row account-row--google">
      <span className="account-row__icon"><GoogleMark /></span>
      <span className="account-row__label">
        {googleEmail ? <>Google: {googleEmail}</> : 'Sign in with Google'}
        {error && <span className="account-row__error">{error}</span>}
        {linking && (
          <span className="account-row__google">
            <GoogleSignInButton divider={false} action={link} />
          </span>
        )}
      </span>
      {googleEmail ? (
        <button type="button" className="account-row__go account-row__btn" onClick={unlink} disabled={busy}>
          {busy ? 'Unlinking…' : 'Unlink'}
        </button>
      ) : (
        <button type="button" className="account-row__go account-row__btn" onClick={() => setLinking((v) => !v)}>
          {linking ? 'Cancel' : 'Link'}
        </button>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
