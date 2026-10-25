import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanStation from './ScanStation';
import { db } from '../db/database';
import * as api from '../services/adminService';

jest.mock('../services/adminService', () => {
  class AdminApiError extends Error {
    constructor(message, { code = null } = {}) { super(message); this.code = code; }
  }
  return { AdminApiError, stationScan: jest.fn() };
});
jest.mock('./CameraScanner', () => ({ __esModule: true, default: () => null }));

jest.setTimeout(20_000);

const AMINA = { studentId: 'stu-1', fullName: 'Amina Hassan', className: 'Form 1 East', cardUid: 'AC221F07' };
const recorded = { outcome: 'recorded', student: AMINA, mark: { status: 'present', createdAt: new Date().toISOString() } };
const offline = () => new api.AdminApiError('Could not reach the SmartAttend server.', { code: 'NETWORK' });

const scan = (user, code) => user.type(screen.getByLabelText('Card number'), `${code}{Enter}`);
const result = () => document.querySelector('.scanst__result');

beforeEach(async () => {
  api.stationScan.mockReset();
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
});

afterAll(async () => {
  if (db.isOpen()) db.close();
  await db.delete();
});

describe('ScanStation', () => {
  it('marks the student present and lists the scan', async () => {
    const user = userEvent.setup();
    api.stationScan.mockResolvedValue(recorded);
    render(<ScanStation />);
    await scan(user, 'ac221f07');
    expect(api.stationScan).toHaveBeenCalledWith('AC221F07');
    await waitFor(() => expect(result()).toHaveTextContent('Amina Hassan'));
    expect(result()).toHaveTextContent(/marked present/);
  });

  it('says so for a card the school does not know', async () => {
    const user = userEvent.setup();
    api.stationScan.mockResolvedValue({ outcome: 'unknown-card', cardUid: 'ZZZZ9999' });
    render(<ScanStation />);
    await scan(user, 'ZZZZ9999');
    await waitFor(() => expect(result()).toHaveTextContent('Card not recognised'));
  });

  it('keeps a scan on the device with no connection, and sends it with its time once back online', async () => {
    const user = userEvent.setup();
    api.stationScan.mockRejectedValue(offline());
    render(<ScanStation />);
    await scan(user, 'AC221F07');

    await waitFor(() => expect(result()).toHaveTextContent('Saved on this device'));
    expect(await screen.findByText(/1 scan saved on this device/)).toBeInTheDocument();
    const [kept] = await db.stationScans.toArray();
    expect(kept.cardUid).toBe('AC221F07');

    // the connection comes back
    api.stationScan.mockResolvedValue(recorded);
    await user.click(screen.getByRole('button', { name: 'Send now' }));

    await waitFor(() => expect(screen.queryByText(/saved on this device, waiting/)).not.toBeInTheDocument());
    expect(api.stationScan).toHaveBeenLastCalledWith('AC221F07', { scannedAt: kept.scannedAt });
    expect(await db.stationScans.count()).toBe(0);
    expect(screen.getByRole('cell', { name: 'Present' })).toBeInTheDocument();
  });

  it('sends scans left from an earlier session when it opens', async () => {
    await db.stationScans.add({ cardUid: 'AC221F07', scannedAt: '2026-10-23T05:10:00.000Z' });
    api.stationScan.mockResolvedValue(recorded);
    render(<ScanStation />);
    await waitFor(() => expect(api.stationScan).toHaveBeenCalledWith('AC221F07', { scannedAt: '2026-10-23T05:10:00.000Z' }));
    await waitFor(async () => expect(await db.stationScans.count()).toBe(0));
  });
});
