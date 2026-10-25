import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, todayISO, countPendingSync } from '../db/database';
import AttendanceForm from './AttendanceForm';

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'teacher.a' } }),
}));

// Stands in for the camera: each button "reads" one card.
jest.mock('./CameraScanner', () => ({
  __esModule: true,
  default: function FakeScanner({ onCode }) {
    return (
      <div>
        <button type="button" onClick={() => onCode('c-001')}>read card C001</button>
        <button type="button" onClick={() => onCode('ZZZZ')}>read unknown card</button>
      </div>
    );
  },
}));

const CLASS = 'class-1';
const TODAY = todayISO();

beforeEach(async () => {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
  await db.students.bulkAdd([
    { studentId: 'stu-1', classGroupId: CLASS, fullName: 'Amina Wanjiru', admissionNo: 'A/001', cardUid: 'C001' },
    { studentId: 'stu-2', classGroupId: CLASS, fullName: 'Kevin Odhiambo', admissionNo: 'A/002' },
  ]);
});

afterEach(() => {
  delete globalThis.fetch;
});

afterAll(async () => {
  if (db.isOpen()) db.close();
  await db.delete();
});

/** A gate server that has scanned Amina in and nobody else. */
function gateWithAminaScanned() {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      classGroupId: CLASS,
      date: TODAY,
      gate: { lastScanAt: new Date().toISOString() },
      records: [{
        eventId: '11111111-1111-4111-8111-111111111111', studentId: 'stu-1', date: TODAY,
        status: 'present', captureMethod: 'fingerprint', verified: true, recordedBy: null,
        reason: null, source: 'simulation', createdAt: new Date().toISOString(),
      }],
    }),
  });
}

const rowFor = (name) => screen.getByText(name).closest('tr');
const tickFor = (name) => screen.getByRole('checkbox', { name: `${name} present` });

describe('AttendanceForm with the school gate', () => {
  it('shows the scan time, and starts everyone who did not scan absent', async () => {
    gateWithAminaScanned();
    render(<AttendanceForm classGroupId={CLASS} />);

    expect(await screen.findByText(/1 of 2 scanned in by card/)).toBeInTheDocument();
    expect(within(rowFor('Amina Wanjiru')).getByText(/scanned .* \(fingerprint\)/)).toBeInTheDocument();
    expect(tickFor('Amina Wanjiru')).toBeChecked();
    // no scan: absent until the teacher ticks them
    expect(tickFor('Kevin Odhiambo')).not.toBeChecked();
    expect(within(rowFor('Kevin Odhiambo')).getByText(/not saved/)).toBeInTheDocument();
    // gate scans are already on the server - nothing to push
    expect(await countPendingSync()).toBe(0);
  });

  it('saves a student who did not scan as absent, with a reason', async () => {
    gateWithAminaScanned();
    const user = userEvent.setup();
    render(<AttendanceForm classGroupId={CLASS} />);
    await screen.findByText(/1 of 2 scanned in by card/);

    const reason = screen.getByRole('combobox', { name: 'Why was Kevin Odhiambo absent?' });
    await user.selectOptions(reason, 'fee');
    expect(reason).toHaveValue('fee');

    await user.click(screen.getByRole('button', { name: /Save attendance \(1\)/ }));

    await waitFor(async () => {
      const kevinRecord = await db.attendanceEvents.where('[studentId+date]').equals(['stu-2', TODAY]).first();
      expect(kevinRecord).toMatchObject({ status: 'absent', reason: 'fee', recordedBy: 'teacher.a' });
    });
    // only Kevin's mark goes up; Amina's gate scan is not re-sent
    expect(await countPendingSync()).toBe(1);
  });

  it('falls back to a full roll call when the gate cannot be reached', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AttendanceForm classGroupId={CLASS} />);

    expect(await screen.findByText(/Offline\. Scan cards, or untick/)).toBeInTheDocument();
    // full roll call: everyone starts ticked present, ready to save
    expect(tickFor('Amina Wanjiru')).toBeChecked();
    expect(tickFor('Kevin Odhiambo')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save attendance (2)' })).toBeEnabled();
  });

  it('tells the teacher when the gate overrode their offline mark', async () => {
    // teacher marked Amina absent while out of range...
    await db.attendanceEvents.add({
      eventId: '99999999-9999-4999-8999-999999999999', studentId: 'stu-1', date: TODAY,
      status: 'absent', captureMethod: 'manual', recordedBy: 'teacher.a', reason: null,
      syncedAt: null, createdAt: new Date().toISOString(),
    });
    await db.syncQueue.add({ eventId: '99999999-9999-4999-8999-999999999999', status: 'pending', createdAt: new Date().toISOString(), attemptCount: 0 });

    // ...but she had scanned in at the gate
    gateWithAminaScanned();
    render(<AttendanceForm classGroupId={CLASS} />);

    expect(await screen.findByText(/Amina Wanjiru scanned their card at .* your "absent" mark was replaced/)).toBeInTheDocument();
    expect(await countPendingSync()).toBe(0);
  });
});

describe('AttendanceForm scanning cards on the phone, offline', () => {
  it('saves each scan at once and starts everyone else absent', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<AttendanceForm classGroupId={CLASS} />);
    await screen.findByText(/Offline\./);

    await user.click(screen.getByRole('button', { name: 'Scan cards' }));
    await user.click(screen.getByRole('button', { name: 'read card C001' }));

    // saved straight away as a card scan, waiting to sync
    await waitFor(async () => {
      const amina = await db.attendanceEvents.where('[studentId+date]').equals(['stu-1', TODAY]).first();
      expect(amina).toMatchObject({ status: 'present', captureMethod: 'rfid', recordedBy: 'teacher.a' });
    });
    expect(await countPendingSync()).toBe(1);
    expect(await screen.findByText(/1 of 2 scanned in by card/)).toBeInTheDocument();
    expect(tickFor('Amina Wanjiru')).toBeChecked();
    expect(tickFor('Kevin Odhiambo')).not.toBeChecked();

    // Kevin is here without his card: the teacher ticks him
    await user.click(tickFor('Kevin Odhiambo'));
    await user.click(screen.getByRole('button', { name: 'Save attendance (1)' }));
    await waitFor(async () => {
      const kevin = await db.attendanceEvents.where('[studentId+date]').equals(['stu-2', TODAY]).first();
      expect(kevin).toMatchObject({ status: 'present', captureMethod: 'manual' });
    });
  });

  it('ignores a card that is not in the class', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<AttendanceForm classGroupId={CLASS} />);
    await screen.findByText(/Offline\./);

    await user.click(screen.getByRole('button', { name: 'Scan cards' }));
    await user.click(screen.getByRole('button', { name: 'read unknown card' }));

    expect(await db.attendanceEvents.count()).toBe(0);
    expect(tickFor('Kevin Odhiambo')).toBeChecked();
  });
});
