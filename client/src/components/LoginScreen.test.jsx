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

describe('LoginScreen school admin sign-up', () => {
  async function openAdminSignUp(user) {
    auth.cognitoConfigured = false;
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    await user.click(screen.getByRole('radio', { name: /School admin/ }));
  }

  async function fillAccount(user) {
    await user.type(screen.getByLabelText('Full name'), 'Grace Achieng');
    await user.type(screen.getByLabelText('Email address'), 'g.achieng@kisumuday.ac.ke');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm password'), 'password123');
  }

  it('only asks for school details when signing up as a school admin', async () => {
    const user = userEvent.setup();
    auth.cognitoConfigured = false;
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.queryByLabelText('School name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /School admin/ }));
    expect(screen.getByLabelText('School name')).toBeRequired();
    expect(screen.getByLabelText('County')).toBeRequired();
    expect(screen.getByText(/reviewed by the SmartAttend team/)).toBeInTheDocument();
  });

  it('sends the school, county and a cleaned-up phone number with the sign-up', async () => {
    const user = userEvent.setup();
    auth.signUp.mockResolvedValue({ needsConfirmation: false });
    await openAdminSignUp(user);
    await user.type(screen.getByLabelText('School name'), 'Kisumu Day Secondary School');
    await user.selectOptions(screen.getByLabelText('County'), 'Kisumu');
    await user.type(screen.getByLabelText(/Phone/), '0712 345 678');
    await fillAccount(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(auth.signUp).toHaveBeenCalledWith({
      name: 'Grace Achieng',
      email: 'g.achieng@kisumuday.ac.ke',
      password: 'password123',
      role: 'admin',
      schoolName: 'Kisumu Day Secondary School',
      county: 'Kisumu',
      phone: '0712345678',
    });
  });

  it('refuses a phone number that is not a Kenyan mobile', async () => {
    const user = userEvent.setup();
    await openAdminSignUp(user);
    await user.type(screen.getByLabelText('School name'), 'Kisumu Day Secondary School');
    await user.selectOptions(screen.getByLabelText('County'), 'Kisumu');
    await user.type(screen.getByLabelText(/Phone/), '12345');
    await fillAccount(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Kenyan mobile number');
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('shows why the school could not be registered', async () => {
    const user = userEvent.setup();
    auth.signUp.mockRejectedValue(authError('SCHOOL_REGISTRATION', 'This school is already registered.'));
    await openAdminSignUp(user);
    await user.type(screen.getByLabelText('School name'), 'Kisumu Day Secondary School');
    await user.selectOptions(screen.getByLabelText('County'), 'Kisumu');
    await fillAccount(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This school is already registered.');
  });

  it('a teacher sign-up carries no school details', async () => {
    const user = userEvent.setup();
    auth.cognitoConfigured = false;
    auth.signUp.mockResolvedValue({ needsConfirmation: false });
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    await fillAccount(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      role: 'teacher', schoolName: null, county: null, phone: null,
    }));
  });
});
