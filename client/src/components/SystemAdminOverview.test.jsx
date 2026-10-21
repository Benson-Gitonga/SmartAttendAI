import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SystemAdminOverview from './SystemAdminOverview';
import * as service from '../services/systemAdminService';

jest.mock('../services/systemAdminService', () => ({
  getAllSchools: jest.fn(),
  approveSchool: jest.fn(),
  rejectSchool: jest.fn(),
  disableSchool: jest.fn(),
  enableSchool: jest.fn(),
}));
const mockSignOut = jest.fn();
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'ops@smartattend.ke' }, signOut: mockSignOut }),
}));
jest.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

const KISUMU = {
  schoolId: 'school-1', name: 'Kisumu Day Secondary School', county: 'Kisumu', status: 'pending',
  adminName: 'Grace Achieng', adminEmail: 'g.achieng@kisumuday.ac.ke', adminPhone: '0712345678',
  createdAt: '2026-10-18 09:30:00', classCount: 0, studentCount: 0,
};
const KIBERA = {
  schoolId: 'school-2', name: 'Kibera Secondary School', county: 'Nairobi', status: 'active',
  createdAt: '2026-09-01 08:00:00', classCount: 3, studentCount: 120,
};
const MOI = {
  schoolId: 'school-3', name: 'Moi Girls', county: 'Uasin Gishu', status: 'inactive',
  reviewNote: 'Subscription lapsed', reviewedAt: '2026-10-10 12:00:00', reviewedBy: 'ops@smartattend.ke',
  createdAt: '2026-08-01 08:00:00', classCount: 2, studentCount: 80,
};

const listing = (schools) => ({
  schools,
  counts: ['pending', 'active', 'inactive', 'rejected'].reduce(
    (acc, s) => ({ ...acc, [s]: schools.filter((x) => x.status === s).length }), {}
  ),
});

const card = (name) => screen.getByText(name).closest('tr');

beforeEach(() => {
  service.getAllSchools.mockResolvedValue(listing([KISUMU, KIBERA, MOI]));
});

describe('SystemAdminOverview', () => {
  it('opens on the approval queue when a school is waiting', async () => {
    render(<SystemAdminOverview />);
    expect(await screen.findByText(KISUMU.name)).toBeInTheDocument();
    expect(screen.queryByText(KIBERA.name)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Pending review/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('g.achieng@kisumuday.ac.ke')).toBeInTheDocument();
  });

  it('opens on every school when nothing is waiting', async () => {
    service.getAllSchools.mockResolvedValue(listing([KIBERA, MOI]));
    render(<SystemAdminOverview />);
    expect(await screen.findByText(KIBERA.name)).toBeInTheDocument();
    expect(screen.getByText(MOI.name)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /All schools/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('approves a school only after the confirmation, then reloads the list', async () => {
    const user = userEvent.setup();
    service.approveSchool.mockResolvedValue({ ...KISUMU, status: 'active' });
    render(<SystemAdminOverview />);

    await screen.findByText(KISUMU.name);
    await user.click(within(card(KISUMU.name)).getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(`Are you sure you want to approve ${KISUMU.name}?`)).toBeInTheDocument();
    expect(service.approveSchool).not.toHaveBeenCalled();

    service.getAllSchools.mockResolvedValue(listing([{ ...KISUMU, status: 'active' }, KIBERA, MOI]));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, approve' }));

    expect(service.approveSchool).toHaveBeenCalledWith('school-1', { note: '' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(service.getAllSchools).toHaveBeenCalledTimes(2);
  });

  it('cancelling the confirmation changes nothing', async () => {
    const user = userEvent.setup();
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    await user.click(within(card(KISUMU.name)).getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(service.approveSchool).not.toHaveBeenCalled();
  });

  it('will not reject without a reason', async () => {
    const user = userEvent.setup();
    service.rejectSchool.mockResolvedValue({ ...KISUMU, status: 'rejected' });
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    await user.click(within(card(KISUMU.name)).getByRole('button', { name: 'Reject' }));

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Yes, reject' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Reason for rejecting'), 'Not on the ministry register');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(service.rejectSchool).toHaveBeenCalledWith('school-1', {
      note: 'Not on the ministry register',
    });
  });

  it('offers disable for an active school and enable for a disabled one', async () => {
    const user = userEvent.setup();
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    await user.click(screen.getByRole('tab', { name: /All schools/ }));

    expect(within(card(KIBERA.name)).getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(within(card(KIBERA.name)).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(card(MOI.name)).getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(within(card(MOI.name)).getByText('Subscription lapsed')).toBeInTheDocument();
  });

  it('shows the server error inside the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    service.disableSchool.mockRejectedValue(new Error('This school changed since the list loaded. Refresh and try again.'));
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    await user.click(screen.getByRole('tab', { name: /Active/ }));
    await user.click(within(card(KIBERA.name)).getByRole('button', { name: 'Disable' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Yes, disable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('changed since the list loaded');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('searches by school, county or admin', async () => {
    const user = userEvent.setup();
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    await user.click(screen.getByRole('tab', { name: /All schools/ }));
    await user.type(screen.getByLabelText('Search schools'), 'uasin');
    expect(screen.getByText(MOI.name)).toBeInTheDocument();
    expect(screen.queryByText(KIBERA.name)).not.toBeInTheDocument();
  });

  it('asks before disabling a school, with a red confirm button', async () => {
    const user = userEvent.setup();
    service.disableSchool.mockResolvedValue({ ...KIBERA, status: 'inactive' });
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    await user.click(screen.getByRole('tab', { name: /Active/ }));

    const disable = within(card(KIBERA.name)).getByRole('button', { name: 'Disable' });
    expect(disable).toHaveClass('sys-btn--danger');
    await user.click(disable);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(`Are you sure you want to disable ${KIBERA.name}?`)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Yes, disable' })).toHaveClass('sa-btn--danger');
    expect(service.disableSchool).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Yes, disable' }));
    expect(service.disableSchool).toHaveBeenCalledWith('school-2', { note: '' });
  });

  it('asks before signing out, and stays signed in on cancel', async () => {
    const user = userEvent.setup();
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByText('Are you sure you want to sign out?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockSignOut).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Yes, sign out' }));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('Escape closes the dialog without doing anything', async () => {
    const user = userEvent.setup();
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    await user.click(within(card(KISUMU.name)).getByRole('button', { name: 'Approve' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(service.approveSchool).not.toHaveBeenCalled();
  });

  it('signs out when the server says the sign-in has ended', async () => {
    service.getAllSchools.mockRejectedValue(Object.assign(new Error('Your system admin sign-in has ended.'), { code: 'UNAUTHORIZED' }));
    render(<SystemAdminOverview />);
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens the details panel from a row, with the same actions', async () => {
    const user = userEvent.setup();
    render(<SystemAdminOverview />);
    await user.click(await screen.findByRole('button', { name: KISUMU.name }));
    const panel = screen.getByRole('complementary', { name: `${KISUMU.name} details` });
    expect(within(panel).getByText('0712345678')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(`Are you sure you want to approve ${KISUMU.name}?`);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(within(panel).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('holds approval until the applicant has confirmed their email', async () => {
    service.getAllSchools.mockResolvedValue(listing([{ ...KISUMU, adminEmailVerified: false }, KIBERA]));
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    expect(within(card(KISUMU.name)).getByText('Email not confirmed')).toBeInTheDocument();
    expect(within(card(KISUMU.name)).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(card(KISUMU.name)).getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('shows who is signed in', async () => {
    render(<SystemAdminOverview />);
    expect(await screen.findByText('ops@smartattend.ke')).toBeInTheDocument();
  });

  it('says so when the server cannot be reached', async () => {
    service.getAllSchools.mockRejectedValue(new Error('network down'));
    render(<SystemAdminOverview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
  });
});
