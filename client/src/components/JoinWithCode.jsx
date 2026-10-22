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
 * A teacher sets their password from the link the school admin sent by
 * WhatsApp, SMS or email (#/join/K7QM-4XPA). The link says who it is for,
 * then they choose a password.
 */
export default function JoinWithCode({ initialCode = '', onBack }) {
  const { joinWithCode } = useAuth();
  const code = formatCode(initialCode);
  const [invite, setInvite] = useState(null); // who the link is for
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(code.length === 9);

  useEffect(() => {
    if (code.length !== 9) return;
    lookupSetupCode(code)
      .then(setInvite)
      .catch((err) => setError(err.message ?? 'This link is not valid.'))
      .finally(() => setBusy(false));
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

  const back = onBack ? (
    <button type="button" className="pub-back pub-linkbtn" onClick={onBack}>← Back to sign in</button>
  ) : (
    <a className="pub-back" href={PUBLIC_PAGES.signin}>← Back to sign in</a>
  );

  if (!invite) {
    return (
      <AuthLayout>
        {back}
        {busy ? (
          <p className="pub-sub">Checking your link…</p>
        ) : (
          <>
            <h1 className="pub-title">This link does not work</h1>
            <p className="pub-sub">Ask your school admin to send you a new one.</p>
            {error && <Alert>{error}</Alert>}
          </>
        )}
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
