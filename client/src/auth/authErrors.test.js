import { signInError, signUpError, confirmError, resendError } from './authErrors';

const cognito = (code, message = 'raw cognito message') => ({ code, message });

describe('signInError', () => {
  it('spots an account whose email was never verified', () => {
    expect(signInError(cognito('UserNotConfirmedException')).code).toBe('NOT_CONFIRMED');
  });

  it('keeps network and wrong-password errors apart', () => {
    expect(signInError(cognito('NetworkError')).code).toBe('NETWORK');
    const wrong = signInError(cognito('NotAuthorizedException', 'Incorrect username or password.'));
    expect(wrong.code).toBe('NOT_AUTHORIZED');
    expect(wrong.message).toBe('Incorrect username or password.');
  });
});

describe('signUpError', () => {
  it('points an existing email at sign-in', () => {
    const err = signUpError(cognito('UsernameExistsException'));
    expect(err.code).toBe('ACCOUNT_EXISTS');
    expect(err.message).toMatch(/Sign in instead/);
  });
});

describe('confirmError', () => {
  it('treats an already-confirmed account as success', () => {
    const lostReply = cognito('NotAuthorizedException', 'User cannot be confirmed. Current status is CONFIRMED');
    expect(confirmError(lostReply)).toBeNull();
  });

  it('gives expired and wrong codes their own messages', () => {
    expect(confirmError(cognito('ExpiredCodeException')).code).toBe('CODE_EXPIRED');
    expect(confirmError(cognito('ExpiredCodeException')).message).toMatch(/Resend code/);
    expect(confirmError(cognito('CodeMismatchException')).code).toBe('CODE_MISMATCH');
    expect(confirmError(cognito('LimitExceededException')).code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('does not swallow other NotAuthorized errors', () => {
    expect(confirmError(cognito('NotAuthorizedException', 'User is disabled.')).code).toBe('CONFIRM_FAILED');
  });
});

describe('resendError', () => {
  it('separates rate limits from network errors', () => {
    expect(resendError(cognito('LimitExceededException')).code).toBe('TOO_MANY_ATTEMPTS');
    expect(resendError(cognito('NetworkError')).code).toBe('NETWORK');
  });
});
