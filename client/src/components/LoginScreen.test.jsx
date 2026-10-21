import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginScreen from './LoginScreen';
import * as session from '../auth/session';

// Filling in the whole application form takes a while when every suite runs at once.
jest.setTimeout(20_000);

const auth = {};
let mockOnline = true;

jest.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
jest.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));
jest.mock('../auth/session', () => ({
  requestPasswordHelp: jest.fn(),
  verifyEmail: jest.fn(),
  lookupEmailLink: jest.fn(),
  lookupSetupCode: jest.fn(),
}));

function authError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

const goTo = (hash) => act(() => {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
});

beforeEach(() => {
  mockOnline = true;
  window.history.replaceState(null, '', '/#/');
  Object.assign(auth, {
    signIn: jest.fn().mockResolvedValue({}),
    registerSchool: jest.fn().mockResolvedValue({ email: 'g.achieng@kisumuday.ac.ke', emailSent: true }),
    setPasswordFromLink: jest.fn().mockResolvedValue({}),
  });
});

async function signInAs(user, email, password) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function fillApplication(user, overrides = {}) {
  const v = {
    school: 'Kisumu Day Secondary School', county: 'Kisumu', code: '20414001', students: '640',
    name: 'Grace Achieng', title: 'Principal', email: 'g.achieng@kisumuday.ac.ke', phone: '0712 345 678', ...overrides,
  };
  if (v.school) await user.type(screen.getByLabelText('School name'), v.school);
  if (v.county) await user.selectOptions(screen.getByLabelText('County'), v.county);
  if (v.code) await user.type(screen.getByLabelText(/School code/), v.code);
  if (v.students) await user.type(screen.getByLabelText(/Number of students/), v.students);
  await user.selectOptions(screen.getByLabelText(/^Type/), 'public');
  await user.selectOptions(screen.getByLabelText(/Day or boarding/), 'mixed');
  if (v.name) await user.type(screen.getByLabelText('Full name'), v.name);
  if (v.title) await user.selectOptions(screen.getByLabelText(/Your role/), v.title);
  if (v.email) await user.type(screen.getByLabelText('Work email'), v.email);
  if (v.phone) await user.type(screen.getByLabelText(/Phone/), v.phone);
}

const submit = (user) => user.click(screen.getByRole('button', { name: 'Submit application' }));

describe('sign in', () => {
  it('signs in with an email', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);
    await signInAs(user, 'teacher@school.ke', 'password123');
    expect(auth.signIn).toHaveBeenCalledWith('teacher@school.ke', 'password123');
  });

  it('accepts the system admin username on the same form', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);
    await signInAs(user, 'sysadmin', '1234');
    expect(auth.signIn).toHaveBeenCalledWith('sysadmin', '1234');
  });

  it("shows the server's reason when sign-in is refused", async () => {
    const user = userEvent.setup();
    auth.signIn.mockRejectedValue(authError('WRONG', 'Wrong email or password.'));
    render(<LoginScreen />);
    await signInAs(user, 'teacher@school.ke', 'nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
  });

  it('keeps the application off the sign-in page: only a link to it', () => {
    render(<LoginScreen />);
    expect(screen.queryByLabelText('School name')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apply for your school' })).toHaveAttribute('href', '#/apply');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '#/forgot-password');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/system admin/i)).not.toBeInTheDocument();
  });

  it('cannot sign in for the first time while offline', () => {
    mockOnline = false;
    render(<LoginScreen />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByText(/You’re offline/)).toBeInTheDocument();
  });
});

describe('school application (#/apply)', () => {
  it('sends the school and the applicant, with no password, then says to check email', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/#/apply');
    render(<LoginScreen />);
    expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument();
    await fillApplication(user);
    await submit(user);

    expect(auth.registerSchool).toHaveBeenCalledWith({
      school: {
        name: 'Kisumu Day Secondary School', county: 'Kisumu', schoolCode: '20414001',
        schoolType: 'public', boarding: 'mixed', studentEstimate: 640,
      },
      applicant: { fullName: 'Grace Achieng', jobTitle: 'Principal', email: 'g.achieng@kisumuday.ac.ke', phone: '0712345678' },
    });
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('g.achieng@kisumuday.ac.ke')).toBeInTheDocument();
  });

  it('marks the fields that need fixing and sends nothing', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/#/apply');
    render(<LoginScreen />);
    await fillApplication(user, { email: 'not-an-email', phone: '12345' });
    await submit(user);
    expect(auth.registerSchool).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText(/Enter a Kenyan mobile number/)).toBeInTheDocument();
  });

  it("shows the server's reason for an email that already has an account", async () => {
    const user = userEvent.setup();
    auth.registerSchool.mockRejectedValue(authError('CONFLICT', 'An account with this email already exists.', { field: 'email' }));
    window.history.replaceState(null, '', '/#/apply');
    render(<LoginScreen />);
    await fillApplication(user);
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('follows the address: the sign-in link opens the application', async () => {
    render(<LoginScreen />);
    await goTo('#/apply');
    expect(screen.getByRole('heading', { name: 'Apply for your school' })).toBeInTheDocument();
    await goTo('#/');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('forgot password (#/forgot-password)', () => {
  it('sends the request and shows the same answer whatever the email', async () => {
    const user = userEvent.setup();
    session.requestPasswordHelp.mockResolvedValue('If that email has a SmartAttend account, we have sent it a link.');
    window.history.replaceState(null, '', '/#/forgot-password');
    render(<LoginScreen />);
    await user.type(screen.getByLabelText('Email'), 'teacher@school.ke');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(session.requestPasswordHelp).toHaveBeenCalledWith('teacher@school.ke');
    expect(await screen.findByText(/If that email has a SmartAttend account/)).toBeInTheDocument();
  });
});

describe('emailed links', () => {
  it('#/verify-email/TOKEN confirms the email', async () => {
    session.verifyEmail.mockResolvedValue({ email: 'g.achieng@kisumuday.ac.ke', schoolName: 'Kisumu Day', schoolStatus: 'pending' });
    window.history.replaceState(null, '', '/#/verify-email/tok123');
    render(<LoginScreen />);
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    expect(session.verifyEmail).toHaveBeenCalledWith('tok123');
  });

  it('#/verify-email explains a used link', async () => {
    session.verifyEmail.mockRejectedValue(authError('LINK', 'This link has already been used.', { state: 'used' }));
    window.history.replaceState(null, '', '/#/verify-email/tok123');
    render(<LoginScreen />);
    expect(await screen.findByRole('heading', { name: 'Email already confirmed' })).toBeInTheDocument();
  });

  it('#/set-password/TOKEN greets the person and sets the password', async () => {
    const user = userEvent.setup();
    session.lookupEmailLink.mockResolvedValue({
      purpose: 'setup', email: 'g.achieng@kisumuday.ac.ke', fullName: 'Grace Achieng', role: 'admin', schoolName: 'Kisumu Day',
    });
    window.history.replaceState(null, '', '/#/set-password/tok456');
    render(<LoginScreen />);
    expect(await screen.findByRole('heading', { name: 'Welcome, Grace' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('New password'), 'a-good-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-good-password');
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    expect(auth.setPasswordFromLink).toHaveBeenCalledWith('tok456', 'a-good-password');
  });

  it('#/set-password checks the two passwords match first', async () => {
    const user = userEvent.setup();
    session.lookupEmailLink.mockResolvedValue({ purpose: 'reset', email: 'a@b.ke', fullName: 'A B', role: 'teacher', schoolName: 'S' });
    window.history.replaceState(null, '', '/#/set-password/tok456');
    render(<LoginScreen />);
    await user.type(await screen.findByLabelText('New password'), 'a-good-password');
    await user.type(screen.getByLabelText('Confirm password'), 'different-one');
    await user.click(screen.getByRole('button', { name: 'Save password and sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(auth.setPasswordFromLink).not.toHaveBeenCalled();
  });

  it('#/set-password explains an expired link', async () => {
    session.lookupEmailLink.mockRejectedValue(authError('LINK', 'This link has expired.', { state: 'expired' }));
    window.history.replaceState(null, '', '/#/set-password/tok456');
    render(<LoginScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
  });
});
