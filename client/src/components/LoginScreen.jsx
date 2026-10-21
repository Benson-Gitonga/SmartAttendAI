import { usePublicRoute } from './auth/publicRoute';
import SignInPage from './auth/SignInPage';
import ApplyPage from './auth/ApplyPage';
import ForgotPasswordPage from './auth/ForgotPasswordPage';
import VerifyEmailPage from './auth/VerifyEmailPage';
import SetPasswordPage from './auth/SetPasswordPage';
import DevOutbox from './auth/DevOutbox';
import JoinWithCode from './JoinWithCode';
import { env } from '../lib/env';

/**
 * Everything before sign-in, one page per address:
 *   #/                    sign in (everyone, the system admin with their username)
 *   #/apply               a school applies to join
 *   #/forgot-password     ask for a reset link
 *   #/join[/CODE]         a teacher with an invite code
 *   #/verify-email/TOKEN  from the applicant's confirmation email
 *   #/set-password/TOKEN  from a set-up (approval, invite) or reset email
 *   #/dev/outbox          development only: emails the server would have sent
 */
export default function LoginScreen() {
  const { page, param } = usePublicRoute();
  switch (page) {
    case 'apply': return <ApplyPage />;
    case 'forgot': return <ForgotPasswordPage />;
    case 'join': return <JoinWithCode key={param ?? ''} initialCode={param ?? ''} />;
    case 'verify': return <VerifyEmailPage key={param} token={param} />;
    case 'setPassword': return <SetPasswordPage key={param} token={param} />;
    case 'outbox': return env.DEV ? <DevOutbox /> : <SignInPage />;
    default: return <SignInPage />;
  }
}
