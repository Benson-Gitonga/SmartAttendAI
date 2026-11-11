import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { lookupSetupCode } from '../auth/session';
import AuthLayout, { Field, PasswordInput, Alert } from './auth/AuthLayout';
import { PUBLIC_PAGES } from './auth/publicRoute';
import GoogleSignInButton from './auth/GoogleSignInButton';
import ApplyPage from './auth/ApplyPage';
import { features } from '../lib/features';

const PASSWORD_MIN = 8;
const formatCode = (raw) => {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
};

/**
 * "I have an invite code" (#/join, or #/join/K7QM-4XPA from a link). One page
 * for two kinds of code:
 *   - a teacher's code from their school admin: say who it is for, then they
 *     choose a password;
 *   - a new school's code from the system admin: they fill in the school's
 *     details and a password, and the school is approved at once.
 * Without a code in the address, or with one that does not work, the page
 * asks for the code.
 */
export default function JoinWithCode({ initialCode = '', onBack }) {
  const [code, setCode] = useState(() => formatCode(initialCode));
  const [invite, setInvite] = useState(null); // who or what the code is for
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(code.length === 9);

  // A typed code: show it as being checked, then look it up.
  function check(next) {
    setCode(next);
    setError(null);
    setBusy(true);
    lookup(next);
  }

  function lookup(next) {
    lookupSetupCode(next)
      .then((found) => {
        setInvite(found);
        // Keep the address shareable without reloading the page.
        if (window.location.hash !== `#/join/${next}`) window.history.replaceState(null, '', `#/join/${next}`);
      })
      .catch((err) => setError(err.state === 'unknown'
        ? 'That code is not right. Check it and try again.'
        : err.message ?? 'That code does not work.'))
      .finally(() => setBusy(false));
  }

  // A code from the link: the first render already shows it as being checked.
  useEffect(() => {
    if (code.length === 9) lookup(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = onBack ? (
    <button type="button" className="pub-back pub-linkbtn" onClick={onBack}>← Back to sign in</button>
  ) : (
    <a className="pub-back" href={PUBLIC_PAGES.signin}>← Back to sign in</a>
  );

  if (!invite) return <EnterCode initialCode={code} error={error} busy={busy} back={back} onSubmit={check} />;
  if (invite.kind === 'school') {
    return <ApplyPage invite={invite} code={code} onChangeCode={() => { setInvite(null); window.history.replaceState(null, '', PUBLIC_PAGES.join); }} />;
  }
  return <StaffSetup invite={invite} code={code} back={back} />;
}

/** The box to type a code into. */
function EnterCode({ initialCode, error, busy, back, onSubmit }) {
  const [value, setValue] = useState(initialCode);
  const ready = value.length === 9;
  return (
    <AuthLayout>
      <form onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onSubmit(value); }} noValidate>
        {back}
        <h1 className="pub-title">Enter your invite code</h1>
        <p className="pub-sub">
          Teachers get a code from their school admin. A new school gets one from the SmartAttend team.
        </p>
        {error && <Alert>{error}</Alert>}
        <Field id="join-code" label="Invite code" hint="8 letters and numbers, like K7QM-4XPA.">
          <input
            id="join-code"
            className="pub-input pub-input--code"
            value={value}
            onChange={(e) => setValue(formatCode(e.target.value))}
            placeholder="XXXX-XXXX"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            autoFocus
          />
        </Field>
        <button className="pub-btn pub-btn--primary pub-btn--block" type="submit" disabled={!ready || busy}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <p className="pub-alt">
          No code? <a className="pub-link" href={PUBLIC_PAGES.apply}>Apply for your school</a> instead.
        </p>
      </form>
    </AuthLayout>
  );
}

/** A teacher (or a reset) chooses a password with the code from their school admin. */
function StaffSetup({ invite, code, back }) {
  const { joinWithCode, setUpWithGoogle } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

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

        {/* The invite link proves the email, so any Google account can be linked instead of a password. */}
        {features.googleSignIn && (
          <GoogleSignInButton
            email={invite.email}
            disabled={busy}
            action={(credential) => setUpWithGoogle({ code }, credential)}
          />
        )}
      </form>
    </AuthLayout>
  );
}
