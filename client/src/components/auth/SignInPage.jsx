import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import AuthLayout, { Field, PasswordInput, Alert } from './AuthLayout';
import { PUBLIC_PAGES } from './publicRoute';
import GoogleSignInButton from './GoogleSignInButton';

/**
 * Sign-in for everyone: school staff with their email, the system admin with
 * their username (no @). Applying and forgotten passwords are
 * links off this page, not part of it.
 */
export default function SignInPage({ notice = null, initialEmail = '' }) {
  const { signIn } = useAuth();
  const online = useOnlineStatus();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err.message ?? 'Sign in failed');
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate>
        <h1 className="pub-title">Sign in</h1>
        <p className="pub-sub">Use the email your school registered you with.</p>

        {!online && (
          <Alert tone="warn">
            You’re offline. Sign in once with a connection; after that SmartAttend opens offline.
          </Alert>
        )}
        {notice && <Alert tone="info">{notice}</Alert>}
        {error && <Alert>{error}</Alert>}

        <Field id="email" label="Email">
          <input
            id="email"
            className="pub-input"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </Field>

        <Field id="password" label="Password">
          <PasswordInput id="password" value={password} onChange={setPassword} disabled={busy} />
        </Field>

        <div className="pub-row pub-row--end">
          <a className="pub-link" href={PUBLIC_PAGES.forgot}>Forgot password?</a>
        </div>

        <button className="pub-btn pub-btn--primary pub-btn--block" type="submit" disabled={busy || !online || !email.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {/* Only for a Google account linked from an invite link or the account sheet. */}
        <GoogleSignInButton disabled={busy || !online} />
      </form>

      <div className="pub-card__foot">
        New to SmartAttend? <a className="pub-link" href={PUBLIC_PAGES.apply}>Apply for your school</a>
      </div>
    </AuthLayout>
  );
}
