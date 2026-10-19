import { render, screen, within } from '@testing-library/react';
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

  it('holds a pending school on its progress page', async () => {
    getMyAccount.mockResolvedValue(account('pending', { submittedAt: '2026-10-18 09:30:00', schoolCode: '20414001' }));
    renderGate();
    expect(await screen.findByText('Your application is being reviewed')).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('Kisumu Day Secondary School')).toBeInTheDocument();
    expect(screen.getByText('Code 20414001')).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('shows the application as three steps, the review being the current one', async () => {
    getMyAccount.mockResolvedValue(account('pending', { submittedAt: '2026-10-18 09:30:00' }));
    renderGate();
    const steps = await screen.findByRole('list', { name: 'Application progress' });
    const items = within(steps).getAllByRole('listitem');
    expect(items.map((li) => li.className)).toEqual([
      'ap-step ap-step--done', 'ap-step ap-step--current', 'ap-step ap-step--todo',
    ]);
    expect(items[0]).toHaveTextContent('Application sent');
    expect(items[0]).toHaveTextContent('18 Oct 2026');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
  });

  it("holds a teacher of a school that isn't active too", async () => {
    auth.user = { ...auth.user, role: 'teacher' };
    getMyAccount.mockResolvedValue(account('inactive'));
    renderGate();
    expect(await screen.findByText('Your school has been disabled')).toBeInTheDocument();
  });

  it('shows the approval, then opens the app by itself, and remembers it', async () => {
    const user = userEvent.setup();
    getMyAccount.mockResolvedValueOnce(account('pending')).mockResolvedValueOnce(account('active'));
    renderGate();
    await user.click(await screen.findByRole('button', { name: /Check again/ }));
    expect(await screen.findByText('Your school is approved!')).toBeInTheDocument();
    expect(await screen.findByText('Admin dashboard', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(auth.refreshSchool).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('shows the rejection, its date and reason, and no "Check again"', async () => {
    getMyAccount.mockResolvedValue(account('rejected', { reviewNote: 'Could not verify the school', reviewedAt: '2026-10-19 07:00:00' }));
    renderGate();
    expect(await screen.findByText('Your application was not approved')).toBeInTheDocument();
    const failed = screen.getByText('Not approved', { selector: '.ap-step__label' }).closest('li');
    expect(failed).toHaveTextContent('Could not verify the school');
    expect(failed).toHaveTextContent('19 Oct 2026');
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
