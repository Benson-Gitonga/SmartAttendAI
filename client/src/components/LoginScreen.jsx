import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  CapIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon, KeypadIcon, UserIcon,
  CheckCircleIcon, SyncIcon, BellIcon,
} from './icons';
import { COUNTIES_AZ } from '../lib/counties';

// Same rule as the server's school registration schema.
const KENYAN_PHONE = /^(\+254|0)[17]\d{8}$/;

const FEATURES = [
  { Icon: CheckCircleIcon, title: 'One-tap class register', text: 'Everyone starts present. Untick who is absent and save.' },
  { Icon: BellIcon, title: 'Early warning', text: 'An ML model flags students at risk of persistent absenteeism.' },
  { Icon: SyncIcon, title: 'Works offline', text: 'Records save on the device and sync when there is a connection.' },
];

/**
 * Views: signin, signup, and confirm (the Cognito email code, never shown in
 * local mode). A sign-up waiting for its code is remembered on the device, so
 * reopening the app returns to the confirm view.
 */
export default function LoginScreen() {
  const {
    signIn, signUp, confirmSignUp, resendConfirmationCode, cognitoConfigured,
    loadPendingSignup, savePendingSignup, clearPendingSignup,
  } = useAuth();
  const online = useOnlineStatus();

  const [view, setView] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState('teacher');
  const [schoolName, setSchoolName] = useState('');
  const [county, setCounty] = useState('');
  const [phone, setPhone] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
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

  async function handleSignUp(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (role === 'admin' && cleanPhone && !KENYAN_PHONE.test(cleanPhone)) {
      setError('Enter a Kenyan mobile number like 0712 345 678, or leave the phone empty.');
      return;
    }
    setBusy(true);
    try {
      const result = await signUp({
        name,
        email,
        password,
        role,
        schoolName: role === 'admin' ? schoolName.trim() : null,
        county: role === 'admin' ? county || null : null,
        phone: role === 'admin' ? cleanPhone || null : null,
      });
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
              <strong>Demo mode:</strong> any email and password signs in on this device.
              Set <code>VITE_COGNITO_USER_POOL_ID</code> and <code>VITE_COGNITO_CLIENT_ID</code> to use AWS Cognito.
            </p>
          )}
        </form>
      )}

      {view === 'signup' && (
        <form className="auth__card" onSubmit={handleSignUp}>
          <div className="auth__logo"><CapIcon size={24} /></div>
          <h1 className="auth__brand">Create your account</h1>
          <p className="auth__tagline">Set up SmartAttend for your school</p>

          {blocked && (
            <div className="notice notice--warn" role="status">
              You’re offline. Connect to the internet to create an account.
            </div>
          )}
          {error && <div className="notice notice--err" role="alert">{error}</div>}
          {notice && <div className="notice notice--info" role="status">{notice}</div>}

          <div className="field">
            <span className="field__label">I am a…</span>
            <div className="role-picker" role="radiogroup" aria-label="Account role">
              <button
                type="button"
                className={`role-picker__opt${role === 'teacher' ? ' role-picker__opt--active' : ''}`}
                role="radio"
                aria-checked={role === 'teacher'}
                onClick={() => setRole('teacher')}
                disabled={busy || blocked}
              >
                <strong>Teacher</strong>
                <span>Take attendance for my own class(es)</span>
              </button>
              <button
                type="button"
                className={`role-picker__opt${role === 'admin' ? ' role-picker__opt--active' : ''}`}
                role="radio"
                aria-checked={role === 'admin'}
                onClick={() => setRole('admin')}
                disabled={busy || blocked}
              >
                <strong>School admin</strong>
                <span>See attendance across every class</span>
              </button>
              <button
                type="button"
                className={`role-picker__opt${role === 'system_admin' ? ' role-picker__opt--active' : ''}`}
                role="radio"
                aria-checked={role === 'system_admin'}
                onClick={() => setRole('system_admin')}
                disabled={busy || blocked}
              >
                <strong>System admin</strong>
                <span>Approve new schools and enable or disable them</span>
              </button>
            </div>
          </div>

          {role === 'admin' && (
            <fieldset className="field-group">
              <legend className="field__label">Your school</legend>
              <p className="field-group__hint">
                Your school is reviewed by the SmartAttend team before it goes live. You can sign in
                straight away and will see when it is approved.
              </p>
              <div className="field">
                <label className="field__label" htmlFor="su-school">School name</label>
                <input
                  id="su-school"
                  className="field__input"
                  type="text"
                  autoComplete="organization"
                  placeholder="e.g. Kibera Secondary School"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  disabled={busy || blocked}
                  minLength={3}
                  required
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field__label" htmlFor="su-county">County</label>
                  <select
                    id="su-county"
                    className="field__input"
                    value={county}
                    onChange={(e) => setCounty(e.target.value)}
                    disabled={busy || blocked}
                    required
                  >
                    <option value="" disabled>Choose…</option>
                    {COUNTIES_AZ.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="su-phone">Phone <span className="field__opt">(optional)</span></label>
                  <input
                    id="su-phone"
                    className="field__input"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="07XX XXX XXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={busy || blocked}
                  />
                </div>
              </div>
            </fieldset>
          )}

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
