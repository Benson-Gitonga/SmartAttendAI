import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  CapIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon, KeypadIcon, UserIcon,
  CheckCircleIcon, SyncIcon, BellIcon, GoogleIcon,
} from './icons';

const FEATURES = [
  { Icon: CheckCircleIcon, title: 'One-tap class register', text: 'Everyone starts present. Untick who is absent and save.' },
  { Icon: BellIcon, title: 'Early warning', text: 'An ML model flags students at risk of persistent absenteeism.' },
  { Icon: SyncIcon, title: 'Works offline', text: 'Records save on the device and sync when there is a connection.' },
];

/**
 * Views: signin, signup, and confirm (the Cognito email code, never shown in
 * local mode). A sign-up waiting for its code is remembered on the device, so
 * reopening the app returns to the confirm view.
 *
 * There is no role picker: the account's role decides which app loads.
 */
export default function LoginScreen() {
  const {
    signIn, signUp, confirmSignUp, resendConfirmationCode, cognitoConfigured,
    signInWithGoogle, googleError,
    loadPendingSignup, savePendingSignup, clearPendingSignup,
  } = useAuth();
  const online = useOnlineStatus();

  const [view, setView] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(googleError ?? null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const blocked = cognitoConfigured && !online && view !== 'confirm';

  useEffect(() => {
    if (!cognitoConfigured) return undefined;
    let cancelled = false;
    loadPendingSignup().then((pending) => {
      if (cancelled || !pending) return;
      setEmail(pending.email);
      setView('confirm');
      setNotice(`Finish setting up your account: enter the code we emailed to ${pending.email}.`);
    });
    return () => { cancelled = true; };
  }, [cognitoConfigured, loadPendingSignup]);

  function switchView(next) {
    setView(next);
    setError(null);
    setNotice(null);
    setBusy(false);
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      if (err.code === 'NOT_CONFIRMED') {
        await openConfirmWithNewCode(email.trim());
        return;
      }
      setError(err.message ?? 'Sign in failed');
      setBusy(false);
    }
  }

  /** The account exists but its email was never verified: send a fresh code. */
  async function openConfirmWithNewCode(address) {
    await savePendingSignup(address);
    switchView('confirm');
    try {
      await resendConfirmationCode(address);
      setNotice(`This account is not verified yet. We sent a new code to ${address}.`);
    } catch (err) {
      setNotice(`This account is not verified yet. Enter the code we emailed to ${address}.`);
      setError(err.message ?? 'Could not send a new code');
    }
  }

  async function handleGoogle() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await signInWithGoogle(); // navigates away on success
    } catch (err) {
      setError(err.message ?? 'Google sign-in failed');
      setBusy(false);
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const result = await signUp({ name, email, password });
      if (result?.needsConfirmation) {
        switchView('confirm');
        setNotice(`We emailed a verification code to ${email.trim()}.`);
      }
    } catch (err) {
      if (err.code === 'ACCOUNT_EXISTS') {
        switchView('signin');
        setNotice(err.message);
        return;
      }
      setError(err.message ?? 'Could not create the account');
      setBusy(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await confirmSignUp(email.trim(), code, password);
      // No password after the app was reopened, so ask for it.
      if (!session) {
        switchView('signin');
        setPassword('');
        setNotice('Your email is verified. Sign in with your password to continue.');
      }
    } catch (err) {
      setError(err.message ?? 'Could not confirm the account');
      setBusy(false);
    }
  }

  async function leaveConfirm() {
    await clearPendingSignup();
    setCode('');
    switchView('signin');
  }

  async function handleResend() {
    setError(null);
    setNotice(null);
    try {
      await resendConfirmationCode(email.trim());
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(err.message ?? 'Could not resend the code');
    }
  }

  const googleBlock = (
    <>
      <button type="button" className="btn btn--outline btn--google" onClick={handleGoogle} disabled={busy || blocked}>
        <GoogleIcon size={18} />
        Continue with Google
      </button>
      <div className="auth__divider">or</div>
    </>
  );

  const revealBtn = (
    <button
      type="button"
      className="field__reveal"
      onClick={() => setReveal((r) => !r)}
      aria-label={reveal ? 'Hide password' : 'Show password'}
    >
      {reveal ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
    </button>
  );

  return (
    <div className="auth auth--split">
      <aside className="auth__aside">
        <div className="auth__aside-brand">
          <span className="auth__aside-logo"><CapIcon size={20} /></span>
          SmartAttend
        </div>
        <div className="auth__aside-body">
          <h2 className="auth__aside-title">Attendance management for Kenyan secondary schools</h2>
          <ul className="auth__features">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title}>
                <span className="auth__feature-icon"><Icon size={18} /></span>
                <span>
                  <b>{title}</b>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth__aside-foot">SmartAttend AI</p>
      </aside>

      <main className="auth__main">
      {view === 'signin' && (
        <form className="auth__card" onSubmit={handleSignIn}>
          <div className="auth__logo"><CapIcon size={24} /></div>
          <h1 className="auth__brand">Welcome back</h1>
          <p className="auth__tagline">Sign in to your SmartAttend account</p>

          {blocked && (
            <div className="notice notice--warn" role="status">
              You’re offline. Connect to the internet to sign in for the first time on this device.
            </div>
          )}
          {error && <div className="notice notice--err" role="alert">{error}</div>}
          {notice && <div className="notice notice--info" role="status">{notice}</div>}

          {googleBlock}

          <div className="field">
            <label className="field__label" htmlFor="email">Email address</label>
            <div className="field__wrap">
              <span className="field__icon"><MailIcon size={18} /></span>
              <input
                id="email"
                className="field__input"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy || blocked}
                required
              />
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="password">Password</label>
            <div className="field__wrap">
              <span className="field__icon"><LockIcon size={18} /></span>
              <input
                id="password"
                className="field__input field__input--reveal"
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || blocked}
                required
              />
              {revealBtn}
            </div>
          </div>

          <button className="btn" type="submit" disabled={busy || blocked}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="auth__switch">
            New to SmartAttend?{' '}
            <button type="button" className="linkbtn" onClick={() => switchView('signup')}>
              Create an account
            </button>
          </p>

          <p className="auth__offline">
            <KeypadIcon size={15} />
            <span>No network? After you have signed in once, you can unlock the app with your offline PIN.</span>
          </p>

          {!cognitoConfigured && (
            <p className="devnote">
              <strong>Demo mode:</strong> any email and password signs in on this device as a teacher.
              Use <code>admin@smartattend.demo</code> for the school admin view
              or <code>sysadmin@smartattend.demo</code> for the system admin view.
              Set <code>VITE_COGNITO_USER_POOL_ID</code> and <code>VITE_COGNITO_CLIENT_ID</code> to use AWS Cognito,
              and <code>VITE_COGNITO_DOMAIN</code> for Google sign-in.
            </p>
          )}
        </form>
      )}

      {view === 'signup' && (
        <form className="auth__card" onSubmit={handleSignUp}>
          <div className="auth__logo"><CapIcon size={24} /></div>
          <h1 className="auth__brand">Create your account</h1>
          <p className="auth__tagline">Teachers start here. Admin access is granted by your school.</p>

          {blocked && (
            <div className="notice notice--warn" role="status">
              You’re offline. Connect to the internet to create an account.
            </div>
          )}
          {error && <div className="notice notice--err" role="alert">{error}</div>}
          {notice && <div className="notice notice--info" role="status">{notice}</div>}

          {googleBlock}

          <div className="field">
            <label className="field__label" htmlFor="su-name">Full name</label>
            <div className="field__wrap">
              <span className="field__icon"><UserIcon size={18} /></span>
              <input
                id="su-name"
                className="field__input"
                type="text"
                autoComplete="name"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy || blocked}
                required
              />
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="su-email">Email address</label>
            <div className="field__wrap">
              <span className="field__icon"><MailIcon size={18} /></span>
              <input
                id="su-email"
                className="field__input"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy || blocked}
                required
              />
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="su-password">Password</label>
            <div className="field__wrap">
              <span className="field__icon"><LockIcon size={18} /></span>
              <input
                id="su-password"
                className="field__input field__input--reveal"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || blocked}
                minLength={8}
                required
              />
              {revealBtn}
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="su-confirm">Confirm password</label>
            <div className="field__wrap">
              <span className="field__icon"><LockIcon size={18} /></span>
              <input
                id="su-confirm"
                className="field__input"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Re-enter password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy || blocked}
                required
              />
            </div>
          </div>

          <button className="btn" type="submit" disabled={busy || blocked}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>

          <p className="auth__switch">
            Already have an account?{' '}
            <button type="button" className="linkbtn" onClick={() => switchView('signin')}>
              Sign in
            </button>
          </p>

          {!cognitoConfigured && (
            <p className="devnote">
              <strong>Demo mode:</strong> the account is saved on this device, with no email verification.
            </p>
          )}
        </form>
      )}

      {view === 'confirm' && (
        <form className="auth__card" onSubmit={handleConfirm}>
          <div className="auth__logo"><CapIcon size={24} /></div>
          <h1 className="auth__brand">Verify your email</h1>
          <p className="auth__tagline">{email.trim()}</p>
          <p className="auth__help">
            Check your inbox and spam folder for a 6-digit code. It stays valid for 24 hours,
            and if you close the app you will come back to this screen.
          </p>

          {cognitoConfigured && !online && (
            <div className="notice notice--warn" role="status">
              You’re offline. You can type the code now, but verifying needs a connection.
            </div>
          )}
          {error && <div className="notice notice--err" role="alert">{error}</div>}
          {notice && <div className="notice notice--info" role="status">{notice}</div>}

          <div className="field">
            <label className="field__label" htmlFor="su-code">Verification code</label>
            <input
              id="su-code"
              className="field__input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
              disabled={busy}
              required
            />
          </div>

          <button className="btn" type="submit" disabled={busy || code.length === 0}>
            {busy ? 'Verifying…' : 'Verify and sign in'}
          </button>

          <div className="auth__foot">
            <button className="linkbtn" type="button" onClick={handleResend} disabled={busy}>
              Resend code
            </button>
            <button className="linkbtn" type="button" onClick={leaveConfirm} disabled={busy}>
              Back to sign in
            </button>
          </div>
        </form>
      )}
      </main>
    </div>
  );
}
