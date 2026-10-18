import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JoinWithCode from './JoinWithCode';
import { lookupSetupCode } from '../auth/session';

const mockAuth = { joinWithCode: jest.fn() };
jest.mock('../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../auth/session', () => ({ lookupSetupCode: jest.fn() }));

const INVITE = { fullName: 'Ms. Mary Otieno', email: 'otieno@kibera.ac.ke', schoolName: 'Kibera Secondary School', purpose: 'invite', expiresAt: '2026-10-26T00:00:00Z' };

beforeEach(() => {
  mockAuth.joinWithCode = jest.fn().mockResolvedValue({});
});

describe('JoinWithCode', () => {
  it('checks the code, says who it is for, then sets the password', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockResolvedValue(INVITE);
    render(<JoinWithCode onBack={jest.fn()} />);

    const input = screen.getByLabelText('Invite code');
    await user.type(input, 'k7qm4xpa');
    expect(input).toHaveValue('K7QM-4XPA');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(lookupSetupCode).toHaveBeenCalledWith('K7QM-4XPA');

    expect(await screen.findByRole('heading', { name: 'Welcome, Mary' })).toBeInTheDocument();
    expect(screen.getByText(/joining Kibera Secondary School/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'otieno-2026');
    await user.type(screen.getByLabelText('Confirm password'), 'otieno-2026');
    await user.click(screen.getByRole('button', { name: 'Finish and sign in' }));
    expect(mockAuth.joinWithCode).toHaveBeenCalledWith('K7QM-4XPA', 'otieno-2026');
  });

  it('a link with the code goes straight to choosing a password', async () => {
    lookupSetupCode.mockResolvedValue(INVITE);
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome, Mary' })).toBeInTheDocument();
  });

  it('explains a code that does not work', async () => {
    const user = userEvent.setup();
    lookupSetupCode.mockRejectedValue(Object.assign(new Error('That code has expired. Ask your school admin for a new one.'), { code: 'CODE', state: 'expired' }));
    render(<JoinWithCode onBack={jest.fn()} />);
    await user.type(screen.getByLabelText('Invite code'), 'K7QM4XPA');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
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

  it('a reset code says so', async () => {
    lookupSetupCode.mockResolvedValue({ ...INVITE, purpose: 'reset' });
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Choose a new password, Mary' })).toBeInTheDocument();
  });
});
