import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { lookupSetupCode } from '../auth/session';
import AuthLayout, { Field, PasswordInput, Alert } from './auth/AuthLayout';
import { PUBLIC_PAGES } from './auth/publicRoute';

const PASSWORD_MIN = 8;
const formatCode = (raw) => {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
};

/**
 * A teacher (or anyone the school admin gave a code) sets their password.
 * Step 1: the code, which tells them who it is for. Step 2: a password.
 * The emailed link is the usual way in; the code is for teachers who got it
 * by WhatsApp, SMS or on paper. A link can carry the code (#/join/K7QM-4XPA).
 */
export default function JoinWithCode({ initialCode = '', onBack }) {
  const { joinWithCode } = useAuth();
  const [code, setCode] = useState(formatCode(initialCode));
  const [invite, setInvite] = useState(null); // who the code is for
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    if (password.length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await joinWithCode(code, password);
    } catch (err) {
      setError(err.message ?? 'Could not finish setting up your account.');
      setBusy(false);
    }
    return undefined;
  }

  const back = invite ? (
    <button type="button" className="pub-back pub-linkbtn" onClick={() => { setInvite(null); setError(null); }}>
      ← Use a different code
    </button>
  ) : onBack ? (
    <button type="button" className="pub-back pub-linkbtn" onClick={onBack}>← Back to sign in</button>
  ) : (
    <a className="pub-back" href={PUBLIC_PAGES.signin}>← Back to sign in</a>
  );

  if (!invite) {
    return (
      <AuthLayout>
        <form onSubmit={(e) => { e.preventDefault(); check(); }} noValidate>
          {back}
          <h1 className="pub-title">Enter your invite code</h1>
          <p className="pub-sub">
            The 8-character code from your school admin. It works once and lasts 7 days. If you got an
            invite email, its link does the same thing.
          </p>
          {error && <Alert>{error}</Alert>}
          <Field id="join-code" label="Invite code">
            <input
              id="join-code"
              className="pub-input pub-input--code"
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
          </Field>
          <button className="pub-btn pub-btn--primary pub-btn--block" type="submit" disabled={busy || code.length !== 9}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  const firstName = invite.fullName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').split(' ')[0];
  return (
    <AuthLayout>
      <form onSubmit={finish} noValidate>
        {back}
        <h1 className="pub-title">{invite.purpose === 'reset' ? `Choose a new password, ${firstName}` : `Welcome, ${firstName}`}</h1>
        <p className="pub-sub">
          {invite.purpose === 'reset'
            ? <>Set a new password for <b>{invite.email}</b> at {invite.schoolName}.</>
            : <>You are joining {invite.schoolName} on SmartAttend as <b>{invite.email}</b>. Choose a password to finish.</>}
        </p>
        {error && <Alert>{error}</Alert>}
        <input type="email" autoComplete="username" value={invite.email} readOnly hidden />
        <Field id="join-password" label="Password" hint={`At least ${PASSWORD_MIN} characters.`}>
          <PasswordInput id="join-password" value={password} onChange={setPassword} autoComplete="new-password" disabled={busy} autoFocus />
        </Field>
        <Field id="join-confirm" label="Confirm password">
          <PasswordInput id="join-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={busy} />
        </Field>
        <button className="pub-btn pub-btn--primary pub-btn--block" type="submit" disabled={busy}>
          {busy ? 'Setting up…' : invite.purpose === 'reset' ? 'Save password and sign in' : 'Finish and sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
