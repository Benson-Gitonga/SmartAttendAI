import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginScreen from './LoginScreen';

const auth = {};

jest.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
jest.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

function authError(code, message) {
  return Object.assign(new Error(message), { code });
}

beforeEach(() => {
  Object.assign(auth, {
    cognitoConfigured: true,
    signIn: jest.fn().mockResolvedValue({}),
    signInWithGoogle: jest.fn().mockResolvedValue(undefined),
    googleError: null,
    signUp: jest.fn(),
    confirmSignUp: jest.fn(),
    resendConfirmationCode: jest.fn().mockResolvedValue(undefined),
    loadPendingSignup: jest.fn().mockResolvedValue(null),
    savePendingSignup: jest.fn().mockResolvedValue(undefined),
    clearPendingSignup: jest.fn().mockResolvedValue(undefined),
  });
});

async function signInAs(user, email, password) {
  await user.type(screen.getByLabelText('Email address'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginScreen email verification', () => {
  it('reopens the verify screen for a sign-up still waiting for its code', async () => {
    auth.loadPendingSignup.mockResolvedValue({ email: 'teacher@school.ke', createdAt: '2026-10-13T08:00:00Z' });
    render(<LoginScreen />);
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(screen.getByText('teacher@school.ke')).toBeInTheDocument();
  });

  it('stays on sign-in when nothing is pending', async () => {
    render(<LoginScreen />);
    await waitFor(() => expect(auth.loadPendingSignup).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('sends an unverified account to the verify screen with a fresh code', async () => {
    const user = userEvent.setup();
    auth.signIn.mockRejectedValue(authError('NOT_CONFIRMED', 'Verify your email'));
    render(<LoginScreen />);
    await signInAs(user, 'teacher@school.ke', 'password123');

    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(auth.savePendingSignup).toHaveBeenCalledWith('teacher@school.ke');
    expect(auth.resendConfirmationCode).toHaveBeenCalledWith('teacher@school.ke');
    expect(screen.getByText(/We sent a new code to teacher@school.ke/)).toBeInTheDocument();
  });

  it('asks for the password after verifying in a reopened app', async () => {
    const user = userEvent.setup();
    auth.loadPendingSignup.mockResolvedValue({ email: 'teacher@school.ke', createdAt: '2026-10-13T08:00:00Z' });
    auth.confirmSignUp.mockResolvedValue(null); // no password in memory, so no session
    render(<LoginScreen />);

    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(auth.confirmSignUp).toHaveBeenCalledWith('teacher@school.ke', '123456', '');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByText(/Your email is verified/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveValue('teacher@school.ke');
  });

  it('forgets the pending sign-up when the teacher goes back', async () => {
    const user = userEvent.setup();
    auth.loadPendingSignup.mockResolvedValue({ email: 'teacher@school.ke', createdAt: '2026-10-13T08:00:00Z' });
    render(<LoginScreen />);
    await user.click(await screen.findByRole('button', { name: 'Back to sign in' }));
    expect(auth.clearPendingSignup).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('never checks for a pending sign-up in local (demo) mode', async () => {
    auth.cognitoConfigured = false;
    render(<LoginScreen />);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(auth.loadPendingSignup).not.toHaveBeenCalled();
  });
});

describe('LoginScreen roles and Google', () => {
  it('never asks people to pick their own role', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByText('School admin')).not.toBeInTheDocument();
  });

  it('starts Google sign-in from the sign-in screen', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(auth.signInWithGoogle).toHaveBeenCalled();
  });

  it('shows why Google sign-in could not start', async () => {
    const user = userEvent.setup();
    auth.signInWithGoogle.mockRejectedValue(authError('GOOGLE_UNAVAILABLE', 'Google sign-in is not set up on this deployment yet'));
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in is not set up');
  });

  it('shows an error from the Google redirect', () => {
    auth.googleError = 'Google sign-in was cancelled';
    render(<LoginScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in was cancelled');
  });
});
