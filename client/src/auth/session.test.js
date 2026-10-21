import { db } from '../db/database';
import {
  signIn, signInWithGoogle, refreshSession, registerSchool, loadStoredSession, authHeaders, isSessionValid, SESSION_KEY,
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
  it('keeps the server token, and stays signed in for as long as it lasts', async () => {
    const fetchImpl = reply(200, SERVER_REPLY);
    const session = await signIn(' g.achieng@kisumuday.ac.ke ', 'pw', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ email: 'g.achieng@kisumuday.ac.ke', password: 'pw' });
    expect(session).toMatchObject({
      mode: 'server', username: 'g.achieng@kisumuday.ac.ke', displayName: 'Grace Achieng', role: 'admin',
      schoolId: 'school-1', schoolStatus: 'pending', token: 'signed.token', tokenExpiresAt: SERVER_REPLY.expiresAt,
    });
    expect(isSessionValid(session)).toBe(true);
    expect(isSessionValid(session, SERVER_REPLY.expiresAt + 1)).toBe(false);
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
  it('sends the application and signs nobody in: the applicant confirms their email next', async () => {
    const fetchImpl = reply(201, { school: { schoolId: 'school-1', status: 'pending' }, email: 'g.achieng@kisumuday.ac.ke', emailSent: true });
    const result = await registerSchool({ school: { name: 'x', county: 'Kisumu' }, applicant: {} }, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/schools/register');
    expect(result.email).toBe('g.achieng@kisumuday.ac.ke');
    expect(await loadStoredSession()).toBeNull();
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

  it('treats a session saved by an older build, with its one-hour lock, as signed in until the token runs out', async () => {
    const session = await signIn('a@b.ke', 'pw', { fetchImpl: reply(200, SERVER_REPLY) });
    expect(isSessionValid({ ...session, expiresAt: Date.now() - 1 })).toBe(true);
  });
});

describe('signInWithGoogle', () => {
  it('sends the Google credential and keeps the session the server returns', async () => {
    const fetchImpl = reply(200, SERVER_REPLY);
    const session = await signInWithGoogle('google.id.token', { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/auth/google');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ credential: 'google.id.token' });
    expect(session.token).toBe('signed.token');
  });

  it('says when no account uses that Google email', async () => {
    const fetchImpl = reply(403, { reason: 'no_account', error: 'No SmartAttend account uses this Google email.', email: 'x@gmail.com' });
    const err = await signInWithGoogle('t', { fetchImpl }).catch((e) => e);
    expect(err).toMatchObject({ code: 'NO_ACCOUNT', email: 'x@gmail.com' });
    expect(await loadStoredSession()).toBeNull();
  });
});

describe('refreshSession', () => {
  it('swaps an old token for a new one', async () => {
    await signIn('a@b.ke', 'pw', { fetchImpl: reply(200, SERVER_REPLY) });
    const fetchImpl = reply(200, { ...SERVER_REPLY, token: 'newer.token' });
    const result = await refreshSession({ fetchImpl, now: Date.now() + 13 * 3_600_000 });
    expect(result.status).toBe('renewed');
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer signed.token' });
    expect(await authHeaders()).toEqual({ Authorization: 'Bearer newer.token' });
  });

  it('leaves a recent token alone, and reports one the server refuses', async () => {
    await signIn('a@b.ke', 'pw', { fetchImpl: reply(200, SERVER_REPLY) });
    const fetchImpl = reply(401);
    expect((await refreshSession({ fetchImpl })).status).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await refreshSession({ fetchImpl, force: true })).status).toBe('signed_out');
  });
});
