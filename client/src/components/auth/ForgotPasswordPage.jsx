import { useState } from 'react';
import { requestPasswordHelp } from '../../auth/session';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import AuthLayout, { Field, Alert } from './AuthLayout';
import { PUBLIC_PAGES } from './publicRoute';

/**
 * Ask for a reset link. The server answers the same for every email, so the
 * page never says whether an account exists.
 */
export default function ForgotPasswordPage() {
  const online = useOnlineStatus();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setSent(await requestPasswordHelp(email));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <h1 className="pub-title">Check your email</h1>
        <Alert tone="info">{sent}</Alert>
        <p className="pub-sub">
          The link works for 1 hour. Teachers can also ask their school admin for a new invite code.
        </p>
        <div className="pub-card__foot">
          <a className="pub-link" href={PUBLIC_PAGES.signin}>Back to sign in</a>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate>
        <a className="pub-back" href={PUBLIC_PAGES.signin}>← Back to sign in</a>
        <h1 className="pub-title">Reset your password</h1>
        <p className="pub-sub">Enter the email you sign in with and we’ll send you a link to choose a new password.</p>
        {!online && <Alert tone="warn">You’re offline. Connect to the internet first.</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field id="forgot-email" label="Email">
          <input
            id="forgot-email"
            className="pub-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </Field>
        <button className="pub-btn pub-btn--primary pub-btn--block" type="submit" disabled={busy || !online || !email.trim()}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthLayout>
  );
}
