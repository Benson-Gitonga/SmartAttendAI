import { db } from '../db/database';
import {
  signIn, registerSchool, loadStoredSession, authHeaders, extendSessionWithPin, isSessionValid, SESSION_KEY,
} from './session';

const reply = (status, body = {}) => jest.fn().mockResolvedValue({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
});

const SERVER_REPLY = {
  token: 'signed.token',
  expiresAt: Date.now() + 30 * 86_400_000,
  user: { userId: 'user-1', email: 'g.achieng@kisumuday.ac.ke', fullName: 'Grace Achieng', role: 'admin', schoolId: 'school-1', jobTitle: 'Principal' },
  school: { schoolId: 'school-1', name: 'Kisumu Day Secondary School', status: 'pending' },
};

beforeEach(async () => {
  await db.authState.clear();
});

describe('signIn', () => {
  it('keeps the server token and locks the app on the device after an hour', async () => {
    const fetchImpl = reply(200, SERVER_REPLY);
    const session = await signIn(' g.achieng@kisumuday.ac.ke ', 'pw', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ email: 'g.achieng@kisumuday.ac.ke', password: 'pw' });
    expect(session).toMatchObject({
      mode: 'server', username: 'g.achieng@kisumuday.ac.ke', displayName: 'Grace Achieng', role: 'admin',
      schoolId: 'school-1', schoolStatus: 'pending', token: 'signed.token', tokenExpiresAt: SERVER_REPLY.expiresAt,
    });
    expect(session.expiresAt).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
    expect(await loadStoredSession()).toMatchObject({ token: 'signed.token' });
  });

  it.each([
    [401, {}, 'WRONG', /Wrong email or password/],
    [403, { reason: 'disabled', error: 'This account has been disabled.' }, 'DISABLED', /disabled/],
    [429, { retryAfterSeconds: 120 }, 'LOCKED', /2 minutes/],
    [500, {}, 'FAILED', /500/],
  ])('explains a %i', async (status, body, code, message) => {
    const err = await signIn('a@b.ke', 'pw', { fetchImpl: reply(status, body) }).catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.message).toMatch(message);
    expect(await loadStoredSession()).toBeNull();
  });

  it('explains a server that cannot be reached', async () => {
    const err = await signIn('a@b.ke', 'pw', { fetchImpl: jest.fn().mockRejectedValue(new TypeError('x')) }).catch((e) => e);
    expect(err.code).toBe('NETWORK');
  });
});

describe('registerSchool', () => {
  it('signs the applicant in as the pending school admin', async () => {
    const fetchImpl = reply(201, SERVER_REPLY);
    const session = await registerSchool({ school: { name: 'x', county: 'Kisumu' }, applicant: {} }, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/schools/register');
    expect(session.schoolStatus).toBe('pending');
  });

  it('passes on which field clashed', async () => {
    const err = await registerSchool({}, { fetchImpl: reply(409, { error: 'taken', field: 'school_code' }) }).catch((e) => e);
    expect(err).toMatchObject({ code: 'CONFLICT', field: 'school_code', message: 'taken' });
  });
});

describe('stored sessions', () => {
  it('drops a session that the server never issued', async () => {
    await db.authState.put({ key: SESSION_KEY, mode: 'local', username: 'old@device.ke', role: 'admin', expiresAt: Date.now() + 1e6 });
    expect(await loadStoredSession()).toBeNull();
    expect(await db.authState.get(SESSION_KEY)).toBeUndefined();
  });

  it('signs requests with the stored token, and nothing when signed out', async () => {
    expect(await authHeaders()).toEqual({});
    await signIn('a@b.ke', 'pw', { fetchImpl: reply(200, SERVER_REPLY) });
    expect(await authHeaders()).toEqual({ Authorization: 'Bearer signed.token' });
  });

  it('a PIN unlock reopens the app but leaves the server token alone', async () => {
    const session = await signIn('a@b.ke', 'pw', { fetchImpl: reply(200, SERVER_REPLY) });
    const locked = { ...session, expiresAt: Date.now() - 1 };
    expect(isSessionValid(locked)).toBe(false);
    const reopened = await extendSessionWithPin(locked);
    expect(isSessionValid(reopened)).toBe(true);
    expect(reopened.token).toBe('signed.token');
    expect(reopened.tokenExpiresAt).toBe(SERVER_REPLY.expiresAt);
  });
});
