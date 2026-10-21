import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { lookupEmailLink } from '../../auth/session';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import AuthLayout, { Field, PasswordInput, Alert } from './AuthLayout';
import { PUBLIC_PAGES } from './publicRoute';
import GoogleSignInButton from './GoogleSignInButton';

const PASSWORD_MIN = 8;
const firstName = (fullName = '') => fullName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').split(' ')[0];

/**
 * From an emailed link: a new account's first password ('setup': a school
 * admin after approval, or an invited teacher) or a forgotten one ('reset').
 * Saving signs straight in.
 */
export default function SetPasswordPage({ token }) {
  const { setPasswordFromLink } = useAuth();
  const online = useOnlineStatus();
  const [link, setLink] = useState({ status: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    lookupEmailLink(token ?? '')
      .then((about) => { if (!cancelled) setLink({ status: 'ok', ...about }); })
      .catch((err) => { if (!cancelled) setLink({ status: 'failed', message: err.message }); });
    return () => { cancelled = true; };
  }, [token]);

  // Signed in: leave the link's address so a refresh does not reuse it.
  function leaveLink() {
    window.history.replaceState(null, '', '#/');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await setPasswordFromLink(token, password);
      leaveLink();
    } catch (err) {
      setError(err.message ?? 'Could not save the password');
      setBusy(false);
    }
    return undefined;
  }

  if (link.status === 'checking') {
    return <AuthLayout><p className="pub-sub" role="status">Checking your link…</p></AuthLayout>;
  }

  if (link.status === 'failed' || link.purpose === 'verify_email') {
    return (
      <AuthLayout>
        <h1 className="pub-title">This link does not work</h1>
        <Alert>{link.message ?? 'This link is for confirming an email, not for setting a password.'}</Alert>
        <p className="pub-sub">
          Get a new one from <a className="pub-link" href={PUBLIC_PAGES.forgot}>Forgot password</a>. Teachers can also ask
          their school admin for a new invite.
        </p>
        <div className="pub-card__foot"><a className="pub-link" href={PUBLIC_PAGES.signin}>Back to sign in</a></div>
      </AuthLayout>
    );
  }

  const reset = link.purpose === 'reset';
  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate>
        <h1 className="pub-title">{reset ? 'Choose a new password' : `Welcome, ${firstName(link.fullName)}`}</h1>
        <p className="pub-sub">
          {reset
            ? <>For <b>{link.email}</b>.</>
            : <>Set a password for <b>{link.email}</b> to finish setting up your {link.role === 'admin' ? 'school admin' : 'teacher'} account at <b>{link.schoolName}</b>.</>}
        </p>
        {!online && <Alert tone="warn">You’re offline. Connect to the internet to set your password.</Alert>}
        {error && <Alert>{error}</Alert>}

        <input type="email" autoComplete="username" value={link.email} readOnly hidden />
        <Field id="new-password" label="New password" hint={`At least ${PASSWORD_MIN} characters.`}>
          <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" disabled={busy} autoFocus />
        </Field>
        <Field id="confirm-password" label="Confirm password">
          <PasswordInput id="confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={busy} />
        </Field>
        <button className="pub-btn pub-btn--primary pub-btn--block" type="submit" disabled={busy || !online}>
          {busy ? 'Saving…' : reset ? 'Save password and sign in' : 'Set password and sign in'}
        </button>

        {/* A new account can skip the password and use Google with the same email. */}
        {!reset && <GoogleSignInButton email={link.email} disabled={busy} onSignedIn={leaveLink} />}
      </form>
    </AuthLayout>
  );
}
