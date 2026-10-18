/** GET /api/auth/me: who is signed in, and their school's current status. */

import { authHeaders } from '../auth/session';

export class AccountError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
  }
}

/**
 * @returns {Promise<{user: object, school: {schoolId, name, county, status, reviewNote}}>}
 * @throws {AccountError} UNAUTHORIZED (signed out or disabled on the server) | FAILED
 */
export async function getMyAccount({ fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl('/api/auth/me', { headers: await authHeaders() });
  if (res.status === 401) throw new AccountError('UNAUTHORIZED', 'Your sign-in has ended. Sign in again.');
  if (!res.ok) throw new AccountError('FAILED', `The server responded ${res.status}.`);
  return res.json();
}
