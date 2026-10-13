import { db } from '../db/database';
import { savePendingSignup, loadPendingSignup, clearPendingSignup } from './pendingSignup';

beforeEach(async () => {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
});

afterAll(async () => {
  if (db.isOpen()) db.close();
  await db.delete();
});

describe('pending sign-up', () => {
  it('survives a reopen and normalises the email', async () => {
    await savePendingSignup('  Teacher@School.ke ', new Date('2026-10-13T08:00:00Z'));
    db.close();
    await db.open();
    expect(await loadPendingSignup()).toEqual({
      email: 'teacher@school.ke',
      createdAt: '2026-10-13T08:00:00.000Z',
    });
  });

  it('never stores a password', async () => {
    await savePendingSignup('teacher@school.ke');
    const row = await db.authState.get('pendingSignup');
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'email', 'key']);
  });

  it('is gone once cleared, and leaves the session alone', async () => {
    await db.authState.put({ key: 'session', username: 'someone' });
    await savePendingSignup('teacher@school.ke');
    await clearPendingSignup();
    expect(await loadPendingSignup()).toBeNull();
    expect(await db.authState.get('session')).toBeTruthy();
  });
});
