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

  it('a link with the code goes straight to choosing a password', async () => {
    lookupSetupCode.mockResolvedValue(INVITE);
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Welcome, Mary' })).toBeInTheDocument();
  });

  it('explains a link that does not work', async () => {
    lookupSetupCode.mockRejectedValue(Object.assign(new Error('This link has expired. Ask your school admin for a new one.'), { code: 'CODE', state: 'expired' }));
    render(<JoinWithCode initialCode="K7QM-4XPA" onBack={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('a page with no code in it says the link does not work', () => {
    render(<JoinWithCode onBack={jest.fn()} />);
    expect(screen.getByRole('heading', { name: 'This link does not work' })).toBeInTheDocument();
    expect(lookupSetupCode).not.toHaveBeenCalled();
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
