import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JoinWithCode from './JoinWithCode';

// The school set-up form is the application page in invite mode; tested here only through the page.
jest.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
import { lookupSetupCode, getGoogleSignInConfig } from '../auth/session';

const mockAuth = { joinWithCode: jest.fn(), registerSchoolWithCode: jest.fn() };
jest.mock('../lib/features', () => ({ features: { googleSignIn: true } }));
jest.mock('../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../auth/session', () => ({ lookupSetupCode: jest.fn(), getGoogleSignInConfig: jest.fn() }));

const INVITE = { fullName: 'Ms. Mary Otieno', email: 'otieno@kibera.ac.ke', schoolName: 'Kibera Secondary School', purpose: 'invite', expiresAt: '2026-10-26T00:00:00Z' };

beforeEach(() => {
  mockAuth.joinWithCode = jest.fn().mockResolvedValue({});
  mockAuth.registerSchoolWithCode = jest.fn().mockResolvedValue({});
  lookupSetupCode.mockReset();
  mockAuth.setUpWithGoogle = jest.fn().mockResolvedValue({});
  getGoogleSignInConfig.mockResolvedValue({ mode: 'off', clientId: null });
});

describe('JoinWithCode', () => {
  it('checks the link, says who it is for, then sets the password', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockResolvedValue(INVITE);
    render(<JoinWithCode initialCode="k7qm4xpa" onBack={jest.fn()} />);
    expect(lookupSetupCode).toHaveBeenCalledWith('K7QM-4XPA');

    expect(await screen.findByRole('heading', { name: 'Welcome, Mary' })).toBeInTheDocument();
    expect(screen.getByText(/joining Kibera Secondary School/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'otieno-2026');
    await user.type(screen.getByLabelText('Confirm password'), 'otieno-2026');
    await user.click(screen.getByRole('button', { name: 'Finish and sign in' }));
    expect(mockAuth.joinWithCode).toHaveBeenCalledWith('K7QM-4XPA', 'otieno-2026');
  });

  it('the invite link can link a Google account instead of a password', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockResolvedValue(INVITE);
    getGoogleSignInConfig.mockResolvedValue({ mode: 'dev', clientId: null });
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    await user.clear(screen.getByLabelText('Google email'));
    await user.type(screen.getByLabelText('Google email'), 'mary.otieno@gmail.com');
    await user.click(screen.getByRole('button', { name: /^Continue$/ }));
    expect(mockAuth.setUpWithGoogle).toHaveBeenCalledWith({ code: 'K7QM-4XPA' }, 'dev:mary.otieno@gmail.com');
    expect(mockAuth.joinWithCode).not.toHaveBeenCalled();
  });

  it('a link with the code goes straight to choosing a password', async () => {
    lookupSetupCode.mockResolvedValue(INVITE);
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome, Mary' })).toBeInTheDocument();
  });

  it('explains a link that does not work, and offers to type another code', async () => {
    lookupSetupCode.mockRejectedValue(Object.assign(new Error('This link has expired. Ask your school admin for a new one.'), { code: 'CODE', state: 'expired' }));
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    expect(screen.getByLabelText('Invite code')).toHaveValue('K7QM-4XPA');
  });

  it('with no code in the address, asks for one and checks it', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockResolvedValue(INVITE);
    render(<JoinWithCode onBack={jest.fn()} />);
    expect(screen.getByRole('heading', { name: 'Enter your invite code' })).toBeInTheDocument();
    expect(lookupSetupCode).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.type(screen.getByLabelText('Invite code'), 'k7qm 4xpa');
    expect(screen.getByLabelText('Invite code')).toHaveValue('K7QM-4XPA');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(lookupSetupCode).toHaveBeenCalledWith('K7QM-4XPA');
    expect(await screen.findByRole('heading', { name: 'Welcome, Mary' })).toBeInTheDocument();
  });

  it('a wrong code says so in plain words', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockRejectedValue(Object.assign(new Error('This link is not valid. Ask your school admin for a new one.'), { code: 'CODE', state: 'unknown' }));
    render(<JoinWithCode onBack={jest.fn()} />);
    await user.type(screen.getByLabelText('Invite code'), 'ABCDEFGH');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right');
  });

  it('a school invite code opens the school set-up form, approved at once', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockResolvedValue({ kind: 'school', schoolName: 'Benson Secondary School', email: 'jane@benson.ac.ke', expiresAt: '2026-11-18T00:00:00Z' });
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Set up your school' })).toBeInTheDocument();
    expect(screen.getByLabelText('School name')).toHaveValue('Benson Secondary School');
    expect(screen.getByLabelText('Work email')).toHaveValue('jane@benson.ac.ke');

    await user.selectOptions(screen.getByLabelText('County'), 'Nairobi');
    await user.type(screen.getByLabelText('Full name'), 'Jane Wanjiku');
    await user.type(screen.getByLabelText('Password'), 'long-enough-1');
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Set up school' }));

    expect(mockAuth.registerSchoolWithCode).toHaveBeenCalledWith('K7QM-4XPA', {
      school: { name: 'Benson Secondary School', county: 'Nairobi' },
      applicant: { fullName: 'Jane Wanjiku', email: 'jane@benson.ac.ke', password: 'long-enough-1' },
    });
  });

  it('the school set-up form checks the passwords first', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockResolvedValue({ kind: 'school', schoolName: null, email: null, expiresAt: '2026-11-18T00:00:00Z' });
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    await user.type(await screen.findByLabelText('School name'), 'Benson Secondary School');
    await user.selectOptions(screen.getByLabelText('County'), 'Nairobi');
    await user.type(screen.getByLabelText('Full name'), 'Jane Wanjiku');
    await user.type(screen.getByLabelText('Work email'), 'jane@benson.ac.ke');
    await user.type(screen.getByLabelText('Password'), 'long-enough-1');
    await user.type(screen.getByLabelText('Confirm password'), 'different-1');
    await user.click(screen.getByRole('button', { name: 'Set up school' }));
    expect(screen.getByText('The two passwords do not match.')).toBeInTheDocument();
    expect(mockAuth.registerSchoolWithCode).not.toHaveBeenCalled();
  });

  it('checks the passwords on the device first', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockResolvedValue(INVITE);
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    await user.type(await screen.findByLabelText('Password'), 'otieno-2026');
    await user.type(screen.getByLabelText('Confirm password'), 'different-1');
    await user.click(screen.getByRole('button', { name: 'Finish and sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(mockAuth.joinWithCode).not.toHaveBeenCalled();
  });

  it('a reset link says so', async () => {
    lookupSetupCode.mockResolvedValue({ ...INVITE, purpose: 'reset' });
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Choose a new password, Mary' })).toBeInTheDocument();
  });
});
