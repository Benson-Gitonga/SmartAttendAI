import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SchoolStatusGate from './SchoolStatusGate';
import { getMyAccount } from '../services/accountService';

const auth = {};
let mockOnline = true;

jest.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
jest.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));
jest.mock('../services/accountService', () => ({ getMyAccount: jest.fn() }));

const SCHOOL_ID = 'school-abc';
const account = (status, extra = {}) => ({
  user: { email: 'g.achieng@kisumuday.ac.ke', role: 'admin', schoolId: SCHOOL_ID },
  school: { schoolId: SCHOOL_ID, name: 'Kisumu Day Secondary School', county: 'Kisumu', status, ...extra },
});

const renderGate = () => render(<SchoolStatusGate><p>Admin dashboard</p></SchoolStatusGate>);

beforeEach(() => {
  mockOnline = true;
  Object.assign(auth, {
    user: { role: 'admin', username: 'g.achieng@kisumuday.ac.ke', schoolId: SCHOOL_ID, schoolStatus: null },
    signOut: jest.fn(),
    refreshSchool: jest.fn().mockResolvedValue(undefined),
  });
});

describe('SchoolStatusGate', () => {
  it('lets the system admin straight through without asking the server', () => {
    auth.user = { role: 'system_admin', username: 'sysadmin' };
    renderGate();
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
    expect(getMyAccount).not.toHaveBeenCalled();
  });

  it('holds a pending school on the waiting screen', async () => {
    getMyAccount.mockResolvedValue(account('pending'));
    renderGate();
    expect(await screen.findByText('Your school is waiting for approval')).toBeInTheDocument();
    expect(screen.getByText('Kisumu Day Secondary School, Kisumu')).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it("holds a teacher of a school that isn't active too", async () => {
    auth.user = { ...auth.user, role: 'teacher' };
    getMyAccount.mockResolvedValue(account('inactive'));
    renderGate();
    expect(await screen.findByText('Your school has been disabled')).toBeInTheDocument();
  });

  it('opens the app when "Check again" finds the school approved, and remembers it', async () => {
    const user = userEvent.setup();
    getMyAccount.mockResolvedValueOnce(account('pending')).mockResolvedValueOnce(account('active'));
    renderGate();
    await user.click(await screen.findByRole('button', { name: /Check again/ }));
    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
    expect(auth.refreshSchool).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('shows the rejection reason and no "Check again"', async () => {
    getMyAccount.mockResolvedValue(account('rejected', { reviewNote: 'Could not verify the school' }));
    renderGate();
    expect(await screen.findByText('Your school registration was not approved')).toBeInTheDocument();
    expect(screen.getByText('Could not verify the school')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check again/ })).not.toBeInTheDocument();
  });

  it('still opens offline for a school last seen active', () => {
    mockOnline = false;
    auth.user = { ...auth.user, schoolStatus: 'active', schoolName: 'Kisumu Day Secondary School' };
    renderGate();
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
    expect(getMyAccount).not.toHaveBeenCalled();
  });

  it('asks for a connection when it has never seen the school', () => {
    mockOnline = false;
    renderGate();
    expect(screen.getByText(/Connect to the internet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeDisabled();
  });

  it('signs out when the server no longer accepts the sign-in', async () => {
    getMyAccount.mockRejectedValue(Object.assign(new Error('ended'), { code: 'UNAUTHORIZED' }));
    renderGate();
    await screen.findByText(/Checking your school/);
    await new Promise((r) => setTimeout(r, 0));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('asks before signing out from the waiting screen', async () => {
    const user = userEvent.setup();
    getMyAccount.mockResolvedValue(account('pending'));
    renderGate();
    await user.click(await screen.findByRole('button', { name: /Sign out/ }));
    expect(auth.signOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });
});
