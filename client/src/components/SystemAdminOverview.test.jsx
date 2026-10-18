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

const card = (name) => screen.getByText(name).closest('article');

beforeEach(() => {
  service.getAllSchools.mockResolvedValue(listing([KISUMU, KIBERA, MOI]));
});

describe('SystemAdminOverview', () => {
  it('opens on the approval queue when a school is waiting', async () => {
    render(<SystemAdminOverview />);
    expect(await screen.findByText(KISUMU.name)).toBeInTheDocument();
    expect(screen.queryByText(KIBERA.name)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Waiting/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('g.achieng@kisumuday.ac.ke')).toBeInTheDocument();
  });

  it('opens on every school when nothing is waiting', async () => {
    service.getAllSchools.mockResolvedValue(listing([KIBERA, MOI]));
    render(<SystemAdminOverview />);
    expect(await screen.findByText(KIBERA.name)).toBeInTheDocument();
    expect(screen.getByText(MOI.name)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('approves a school only after the confirmation, then reloads the list', async () => {
    const user = userEvent.setup();
    service.approveSchool.mockResolvedValue({ ...KISUMU, status: 'active' });
    render(<SystemAdminOverview />);

    await screen.findByText(KISUMU.name);
    await user.click(within(card(KISUMU.name)).getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(`Approve ${KISUMU.name}?`)).toBeInTheDocument();
    expect(service.approveSchool).not.toHaveBeenCalled();

    service.getAllSchools.mockResolvedValue(listing([{ ...KISUMU, status: 'active' }, KIBERA, MOI]));
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

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
    const confirm = within(dialog).getByRole('button', { name: 'Reject' });
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
    await user.click(screen.getByRole('tab', { name: /All/ }));

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
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('changed since the list loaded');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('searches by school, county or admin', async () => {
    const user = userEvent.setup();
    render(<SystemAdminOverview />);
    await screen.findByText(KISUMU.name);
    await user.click(screen.getByRole('tab', { name: /All/ }));
    await user.type(screen.getByLabelText('Search schools'), 'uasin');
    expect(screen.getByText(MOI.name)).toBeInTheDocument();
    expect(screen.queryByText(KIBERA.name)).not.toBeInTheDocument();
  });

  it('signs out when the server says the sign-in has ended', async () => {
    service.getAllSchools.mockRejectedValue(Object.assign(new Error('Your system admin sign-in has ended.'), { code: 'UNAUTHORIZED' }));
    render(<SystemAdminOverview />);
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
