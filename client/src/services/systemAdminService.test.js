import { loginSystemAdmin, getAllSchools, approveSchool } from './systemAdminService';

jest.mock('../auth/session', () => ({
  loadStoredSession: jest.fn().mockResolvedValue({ role: 'system_admin', token: 'signed.token' }),
}));

const reply = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

afterEach(() => { delete globalThis.fetch; });

describe('loginSystemAdmin', () => {
  it('returns the token from the server', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { token: 't', username: 'sysadmin', expiresAt: 1 }));
    expect(await loginSystemAdmin(' sysadmin ', 'pw', { fetchImpl })).toEqual({ token: 't', username: 'sysadmin', expiresAt: 1 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ username: 'sysadmin', password: 'pw' });
  });

  it.each([
    [401, {}, 'WRONG', /Wrong username or password/],
    [429, { retryAfterSeconds: 600 }, 'LOCKED', /Try again in 10 minutes/],
    [503, {}, 'NOT_SET_UP', /not set up/],
  ])('explains a %i', async (status, body, code, message) => {
    const err = await loginSystemAdmin('a@b.ke', 'pw', { fetchImpl: jest.fn().mockResolvedValue(reply(status, body)) }).catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.message).toMatch(message);
  });

  it('explains a server that cannot be reached', async () => {
    const err = await loginSystemAdmin('a@b.ke', 'pw', { fetchImpl: jest.fn().mockRejectedValue(new TypeError('x')) }).catch((e) => e);
    expect(err.code).toBe('NETWORK');
  });
});

describe('signed-in calls', () => {
  it('send the stored token', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(reply(200, { schools: [], counts: { pending: 0 } }));
    await getAllSchools();
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer signed.token');
  });

  it('report an ended sign-in as UNAUTHORIZED', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(reply(401));
    await expect(approveSchool('school-1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('send only the note, never who is acting', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(reply(200, {}));
    await approveSchool('school-1', { note: '  ok  ', actor: 'someone' });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ note: 'ok' });
  });
});
