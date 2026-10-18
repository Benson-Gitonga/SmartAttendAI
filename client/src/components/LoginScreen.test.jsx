import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginScreen from './LoginScreen';

// Filling in the whole application form takes a while when every suite runs at once.
jest.setTimeout(20_000);

const auth = {};
let mockOnline = true;

jest.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
jest.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));

function authError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

beforeEach(() => {
  mockOnline = true;
  Object.assign(auth, {
    signIn: jest.fn().mockResolvedValue({}),
    registerSchool: jest.fn().mockResolvedValue({}),
  });
});

async function signInAs(user, email, password) {
  await user.type(screen.getByLabelText('Email or username'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function openRegister(user) {
  render(<LoginScreen />);
  await user.click(screen.getByRole('button', { name: /Register your school/ }));
}

async function fillApplication(user, overrides = {}) {
  const v = {
    school: 'Kisumu Day Secondary School', county: 'Kisumu', code: '20414001', students: '640',
    name: 'Grace Achieng', title: 'Principal', email: 'g.achieng@kisumuday.ac.ke', phone: '0712 345 678',
    password: 'kisumu-day-2026', confirm: 'kisumu-day-2026', ...overrides,
  };
  if (v.school) await user.type(screen.getByLabelText('School name'), v.school);
  if (v.county) await user.selectOptions(screen.getByLabelText('County'), v.county);
  if (v.code) await user.type(screen.getByLabelText(/School code/), v.code);
  if (v.students) await user.type(screen.getByLabelText(/Students/), v.students);
  await user.selectOptions(screen.getByLabelText('Type'), 'public');
  await user.selectOptions(screen.getByLabelText('Day or boarding'), 'mixed');
  if (v.name) await user.type(screen.getByLabelText('Full name'), v.name);
  if (v.title) await user.selectOptions(screen.getByLabelText('Your role'), v.title);
  if (v.email) await user.type(screen.getByLabelText('Email address'), v.email);
  if (v.phone) await user.type(screen.getByLabelText(/Phone/), v.phone);
  if (v.password) await user.type(screen.getByLabelText('Password'), v.password);
  if (v.confirm) await user.type(screen.getByLabelText('Confirm password'), v.confirm);
}

const send = (user) => user.click(screen.getByRole('button', { name: 'Send application' }));

describe('LoginScreen sign-in', () => {
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

  it('has no open sign-up, no role picker and no demo-mode note', () => {
    render(<LoginScreen />);
    expect(screen.queryByRole('button', { name: 'Create an account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument();
    expect(screen.queryByText(/system admin/i)).not.toBeInTheDocument();
  });

  it('cannot sign in for the first time while offline', () => {
    mockOnline = false;
    render(<LoginScreen />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByText(/You’re offline/)).toBeInTheDocument();
  });
});

describe('LoginScreen school application', () => {
  it('sends the school and the applicant in the shape the server expects', async () => {
    const user = userEvent.setup();
    await openRegister(user);
    await fillApplication(user);
    await send(user);

    expect(auth.registerSchool).toHaveBeenCalledWith({
      school: {
        name: 'Kisumu Day Secondary School',
        county: 'Kisumu',
        schoolCode: '20414001',
        schoolType: 'public',
        boarding: 'mixed',
        studentEstimate: 640,
      },
      applicant: {
        fullName: 'Grace Achieng',
        jobTitle: 'Principal',
        email: 'g.achieng@kisumuday.ac.ke',
        phone: '0712345678',
        password: 'kisumu-day-2026',
      },
    });
  });

  it.each([
    ['no county', { county: '' }, /Choose the county/],
    ['a school code with spaces', { code: '204 140' }, /letters and numbers only/],
    ['a phone that is not Kenyan', { phone: '12345' }, /Kenyan mobile number/],
    ['a short password', { password: 'short', confirm: 'short' }, /at least 8 characters/],
    ['passwords that do not match', { confirm: 'something-else' }, /do not match/],
  ])('stops %s before sending', async (label, overrides, message) => {
    const user = userEvent.setup();
    await openRegister(user);
    await fillApplication(user, overrides);
    await send(user);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(auth.registerSchool).not.toHaveBeenCalled();
  });

  it('sends an email that already has an account back to sign-in', async () => {
    const user = userEvent.setup();
    auth.registerSchool.mockRejectedValue(
      authError('CONFLICT', 'An account with this email already exists. Sign in instead.', { field: 'email' })
    );
    await openRegister(user);
    await fillApplication(user);
    await send(user);

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email or username')).toHaveValue('g.achieng@kisumuday.ac.ke');
  });

  it('shows a school that is already registered', async () => {
    const user = userEvent.setup();
    auth.registerSchool.mockRejectedValue(
      authError('CONFLICT', 'A school with this code is already registered on SmartAttend.', { field: 'school_code' })
    );
    await openRegister(user);
    await fillApplication(user);
    await send(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('already registered');
  });

  it('goes back to sign-in', async () => {
    const user = userEvent.setup();
    await openRegister(user);
    await user.click(screen.getByRole('button', { name: /Back to sign in/ }));
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
});
