import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { lookupSetupCode } from '../auth/session';
import { KeypadIcon, LockIcon, EyeIcon, EyeOffIcon, ChevronLeftIcon, CheckCircleIcon } from './icons';

const PASSWORD_MIN = 8;
const formatCode = (raw) => {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
};

/**
 * A teacher (or anyone the school admin gave a code) sets their password.
 * Step 1: the code, which tells them who it is for. Step 2: a password.
 * The admin can also send a link with the code in it (#/join/K7QM-4XPA).
 */
export default function JoinWithCode({ initialCode = '', onBack }) {
  const { joinWithCode } = useAuth();
  const [code, setCode] = useState(formatCode(initialCode));
  const [invite, setInvite] = useState(null); // who the code is for
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function check(value = code) {
    setError(null);
    setBusy(true);
    try {
      setInvite(await lookupSetupCode(value));
    } catch (err) {
      setError(err.message ?? 'That code is not right.');
    } finally {
      setBusy(false);
    }
  }

  // A link with the code in it goes straight to step 2.
  useEffect(() => {
    if (formatCode(initialCode).length === 9) check(formatCode(initialCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish(e) {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN) return setError(`Choose a password of at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await joinWithCode(code, password);
    } catch (err) {
      setError(err.message ?? 'Could not finish setting up your account.');
      setBusy(false);
    }
  }

  const back = (
    <button type="button" className="auth__back" onClick={invite ? () => { setInvite(null); setError(null); } : onBack}>
      <ChevronLeftIcon size={16} /> {invite ? 'Use a different code' : 'Back to sign in'}
    </button>
  );

  if (!invite) {
    return (
      <form className="auth__card" onSubmit={(e) => { e.preventDefault(); check(); }}>
        {back}
        <div className="auth__logo"><KeypadIcon size={24} /></div>
        <h1 className="auth__brand">Enter your invite code</h1>
        <p className="auth__tagline">
          Your school admin sent you an 8-character code by WhatsApp, SMS or email. It works once
          and lasts 7 days.
        </p>
        {error && <div className="notice notice--err" role="alert">{error}</div>}
        <div className="field">
          <label className="field__label" htmlFor="join-code">Invite code</label>
          <input
            id="join-code"
            className="field__input join-code"
            type="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(formatCode(e.target.value))}
            disabled={busy}
            autoFocus
          />
        </div>
        <button className="btn" type="submit" disabled={busy || code.length !== 9}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    );
  }

  const firstName = invite.fullName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').split(' ')[0];
  return (
    <form className="auth__card" onSubmit={finish}>
      {back}
      <div className="auth__logo"><CheckCircleIcon size={24} /></div>
      <h1 className="auth__brand">{invite.purpose === 'reset' ? `Choose a new password, ${firstName}` : `Welcome, ${firstName}`}</h1>
      <p className="auth__tagline">
        {invite.purpose === 'reset'
          ? `Set a new password for ${invite.email} at ${invite.schoolName}.`
          : `You are joining ${invite.schoolName} on SmartAttend as ${invite.email}. Choose a password to finish.`}
      </p>
      {error && <div className="notice notice--err" role="alert">{error}</div>}

      <div className="field">
        <label className="field__label" htmlFor="join-password">Password</label>
        <div className="field__wrap">
          <span className="field__icon"><LockIcon size={18} /></span>
          <input id="join-password" className="field__input field__input--reveal" type={reveal ? 'text' : 'password'}
            autoComplete="new-password" placeholder={`At least ${PASSWORD_MIN} characters`} value={password}
            onChange={(e) => setPassword(e.target.value)} disabled={busy} autoFocus />
          <button type="button" className="field__reveal" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide password' : 'Show password'}>
            {reveal ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
          </button>
        </div>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="join-confirm">Confirm password</label>
        <div className="field__wrap">
          <span className="field__icon"><LockIcon size={18} /></span>
          <input id="join-confirm" className="field__input" type={reveal ? 'text' : 'password'} autoComplete="new-password"
            placeholder="Type it again" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
        </div>
      </div>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Setting up…' : invite.purpose === 'reset' ? 'Save password and sign in' : 'Finish and sign in'}
      </button>
      <p className="auth__offline">
        <KeypadIcon size={15} />
        <span>Next time, sign in with {invite.email} and this password.</span>
      </p>
    </form>
  );
}
