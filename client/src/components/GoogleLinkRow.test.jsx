import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoogleLinkRow from './GoogleLinkRow';
import { getGoogleSignInConfig, setLinkedGoogle } from '../auth/session';
import { getMyAccount } from '../services/accountService';

jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ signInWithGoogle: jest.fn() }) }));
jest.mock('../auth/session', () => ({ getGoogleSignInConfig: jest.fn(), setLinkedGoogle: jest.fn() }));
jest.mock('../services/accountService', () => ({ getMyAccount: jest.fn() }));

const account = (googleEmail) => ({ user: { email: 'otieno@kibera.ac.ke', googleEmail }, school: {} });

beforeEach(() => {
  getGoogleSignInConfig.mockResolvedValue({ mode: 'dev', clientId: null });
});

describe('GoogleLinkRow', () => {
  it('links a Google account from the sheet', async () => {
    const user = userEvent.setup();
    getMyAccount.mockResolvedValue(account(null));
    setLinkedGoogle.mockResolvedValue(account('mary@gmail.com'));
    render(<GoogleLinkRow online />);

    await user.click(await screen.findByRole('button', { name: 'Link' }));
    await user.click(screen.getByRole('button', { name: /Continue with Google/ }));
    await user.type(screen.getByLabelText('Google email'), 'mary@gmail.com');
    await user.click(screen.getByRole('button', { name: /^Continue$/ }));

    expect(setLinkedGoogle).toHaveBeenCalledWith('dev:mary@gmail.com');
    expect(await screen.findByText('Google: mary@gmail.com')).toBeInTheDocument();
  });

  it('unlinks, and explains when Google is the only way in', async () => {
    const user = userEvent.setup();
    getMyAccount.mockResolvedValue(account('mary@gmail.com'));
    setLinkedGoogle.mockRejectedValue(new Error('Set a password first'));
    render(<GoogleLinkRow online />);

    await user.click(await screen.findByRole('button', { name: 'Unlink' }));
    expect(setLinkedGoogle).toHaveBeenCalledWith(null);
    expect(await screen.findByText('Set a password first')).toBeInTheDocument();
  });

  it('is hidden when the server has Google sign-in off', async () => {
    getGoogleSignInConfig.mockResolvedValue({ mode: 'off', clientId: null });
    getMyAccount.mockResolvedValue(account(null));
    const { container } = render(<GoogleLinkRow online />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(getMyAccount).not.toHaveBeenCalled();
  });
});
