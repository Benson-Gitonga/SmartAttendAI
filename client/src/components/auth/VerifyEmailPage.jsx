import { useEffect, useState } from 'react';
import { verifyEmail } from '../../auth/session';
import AuthLayout, { Alert } from './AuthLayout';
import { PUBLIC_PAGES } from './publicRoute';

/** The applicant clicked the confirmation link in their email. */
export default function VerifyEmailPage({ token }) {
  const [state, setState] = useState({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    verifyEmail(token ?? '')
      .then((result) => { if (!cancelled) setState({ status: 'done', ...result }); })
      .catch((err) => { if (!cancelled) setState({ status: 'failed', message: err.message, linkState: err.state }); });
    return () => { cancelled = true; };
  }, [token]);

  if (state.status === 'checking') {
    return <AuthLayout><p className="pub-sub" role="status">Confirming your email…</p></AuthLayout>;
  }

  if (state.status === 'failed') {
    const alreadyUsed = state.linkState === 'used';
    return (
      <AuthLayout>
        <h1 className="pub-title">{alreadyUsed ? 'Email already confirmed' : 'This link does not work'}</h1>
        <Alert tone={alreadyUsed ? 'info' : 'error'}>{state.message}</Alert>
        {!alreadyUsed && (
          <p className="pub-sub">
            You can get a new confirmation email from <a className="pub-link" href={PUBLIC_PAGES.forgot}>Forgot password</a>,
            using the email you applied with.
          </p>
        )}
        <div className="pub-card__foot"><a className="pub-link" href={PUBLIC_PAGES.signin}>Back to sign in</a></div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="pub-title">Email confirmed</h1>
      <p className="pub-sub">
        Thank you. <b>{state.email}</b> is confirmed, and the application for <b>{state.schoolName}</b> is now with
        our team.
      </p>
      <p className="pub-sub">
        {state.schoolStatus === 'active'
          ? 'The school is already approved: use the set-up link in your approval email to choose a password.'
          : 'We will email you the decision. If approved, the email has a link to set your password.'}
      </p>
      <div className="pub-card__foot"><a className="pub-link" href={PUBLIC_PAGES.signin}>Back to sign in</a></div>
    </AuthLayout>
  );
}
