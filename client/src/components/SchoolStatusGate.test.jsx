import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SchoolStatusGate from './SchoolStatusGate';
import { getSchoolStatus } from '../services/schoolService';

const auth = {};
let mockOnline = true;

jest.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
jest.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));
jest.mock('../services/schoolService', () => ({ getSchoolStatus: jest.fn() }));

const SCHOOL_ID = 'school-abc';
const school = (status, extra = {}) => ({
  schoolId: SCHOOL_ID, name: 'Kisumu Day Secondary School', county: 'Kisumu', status, ...extra,
});

const renderGate = () => render(<SchoolStatusGate><p>Admin dashboard</p></SchoolStatusGate>);

beforeEach(() => {
  mockOnline = true;
  localStorage.clear();
  Object.assign(auth, {
    user: { role: 'admin', username: 'g.achieng@kisumuday.ac.ke', schoolId: SCHOOL_ID },
    signOut: jest.fn(),
  });
});

describe('SchoolStatusGate', () => {
  it('lets teachers straight through without asking the server', () => {
    auth.user = { role: 'teacher', username: 't@school.ke', schoolId: 'school-local-001' };
    renderGate();
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
    expect(getSchoolStatus).not.toHaveBeenCalled();
  });

  it('lets an admin of the old single local school through', () => {
    auth.user = { role: 'admin', username: 'a@school.ke', schoolId: 'school-local-001' };
    renderGate();
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
  });

  it('holds a pending school on the waiting screen', async () => {
    getSchoolStatus.mockResolvedValue(school('pending'));
    renderGate();
    expect(await screen.findByText('Your school is waiting for approval')).toBeInTheDocument();
    expect(screen.getByText('Kisumu Day Secondary School, Kisumu')).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('opens the dashboard when "Check again" finds the school approved', async () => {
    const user = userEvent.setup();
    getSchoolStatus.mockResolvedValueOnce(school('pending')).mockResolvedValueOnce(school('active'));
    renderGate();
    await user.click(await screen.findByRole('button', { name: /Check again/ }));
    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
  });

  it('shows the rejection reason and no "Check again"', async () => {
    getSchoolStatus.mockResolvedValue(school('rejected', { reviewNote: 'Could not verify the school' }));
    renderGate();
    expect(await screen.findByText('Your school registration was not approved')).toBeInTheDocument();
    expect(screen.getByText('Could not verify the school')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check again/ })).not.toBeInTheDocument();
  });

  it('blocks a disabled school', async () => {
    getSchoolStatus.mockResolvedValue(school('inactive'));
    renderGate();
    expect(await screen.findByText('Your school has been disabled')).toBeInTheDocument();
  });

  it('still opens offline for a school last seen active', () => {
    mockOnline = false;
    localStorage.setItem(`smartattend:school-status:${SCHOOL_ID}`, JSON.stringify(school('active')));
    renderGate();
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument();
    expect(getSchoolStatus).not.toHaveBeenCalled();
  });

  it('asks for a connection when it has never seen the school', () => {
    mockOnline = false;
    renderGate();
    expect(screen.getByText(/Connect to the internet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeDisabled();
  });

  it('signs out from the waiting screen', async () => {
    const user = userEvent.setup();
    getSchoolStatus.mockResolvedValue(school('pending'));
    renderGate();
    await user.click(await screen.findByRole('button', { name: /Sign out/ }));
    expect(auth.signOut).toHaveBeenCalled();
  });
});
