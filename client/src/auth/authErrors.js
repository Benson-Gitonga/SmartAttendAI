/**
 * Cognito error codes -> AuthError codes and messages a teacher can act on.
 * Kept apart from cognito.js so it can be tested without the Cognito SDK.
 */

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

const isNetwork = (err) => err?.code === 'NetworkError';

/** @returns {AuthError} NETWORK | NOT_CONFIRMED | NOT_AUTHORIZED */
export function signInError(err) {
  if (isNetwork(err)) return new AuthError('NETWORK', err?.message ?? 'No connection');
  if (err?.code === 'UserNotConfirmedException') {
    return new AuthError('NOT_CONFIRMED', 'Verify your email to finish setting up your account.');
  }
  return new AuthError('NOT_AUTHORIZED', err?.message ?? 'Sign in failed');
}

/** @returns {AuthError} NETWORK | ACCOUNT_EXISTS | SIGNUP_FAILED */
export function signUpError(err) {
  if (isNetwork(err)) return new AuthError('NETWORK', err?.message ?? 'No connection');
  if (err?.code === 'UsernameExistsException') {
    return new AuthError(
      'ACCOUNT_EXISTS',
      'An account with this email already exists. Sign in instead; if it is not verified yet, we will send a new code.'
    );
  }
  return new AuthError('SIGNUP_FAILED', err?.message ?? 'Could not create the account');
}

/**
 * Confirming an account that is already confirmed (for example, the first try
 * went through but the reply was lost on a weak connection) is not an error.
 *
 * @returns {AuthError|null} null when the account is already confirmed;
 *   otherwise NETWORK | CODE_EXPIRED | CODE_MISMATCH | TOO_MANY_ATTEMPTS | CONFIRM_FAILED
 */
export function confirmError(err) {
  if (isNetwork(err)) return new AuthError('NETWORK', err?.message ?? 'No connection');
  if (err?.code === 'NotAuthorizedException' && /CONFIRMED/i.test(err?.message ?? '')) return null;
  if (err?.code === 'ExpiredCodeException') {
    return new AuthError('CODE_EXPIRED', 'That code has expired. Tap "Resend code" for a new one.');
  }
  if (err?.code === 'CodeMismatchException') {
    return new AuthError('CODE_MISMATCH', 'That code does not match. Check the most recent email we sent.');
  }
  if (err?.code === 'LimitExceededException' || err?.code === 'TooManyFailedAttemptsException') {
    return new AuthError('TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes and try again.');
  }
  return new AuthError('CONFIRM_FAILED', err?.message ?? 'Could not confirm the account');
}

/** @returns {AuthError} NETWORK | TOO_MANY_ATTEMPTS | RESEND_FAILED */
export function resendError(err) {
  if (isNetwork(err)) return new AuthError('NETWORK', err?.message ?? 'No connection');
  if (err?.code === 'LimitExceededException') {
    return new AuthError('TOO_MANY_ATTEMPTS', 'Too many codes requested. Wait a few minutes and try again.');
  }
  return new AuthError('RESEND_FAILED', err?.message ?? 'Could not resend the code');
}
