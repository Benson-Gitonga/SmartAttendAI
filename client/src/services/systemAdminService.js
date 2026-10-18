/**
 * Fetch wrappers for server/src/routes/systemAdmin.js. The system admin signs
 * in against the server (never the PWA), and every call after that carries
 * the token the server returned.
 */

import { loadStoredSession } from '../auth/cognito';

export class SystemAdminError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SystemAdminError';
    this.code = code;
  }
}

/**
 * @returns {Promise<{token:string, email:string, expiresAt:number}>}
 * @throws {SystemAdminError} WRONG | LOCKED | NOT_SET_UP | NETWORK | FAILED
 */
export async function loginSystemAdmin(email, password, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl('/api/system-admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
  } catch {
    throw new SystemAdminError('NETWORK', 'Could not reach the SmartAttend server. The system admin must sign in online.');
  }
  if (res.ok) return res.json();

  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new SystemAdminError('WRONG', 'Wrong email or password.');
  if (res.status === 429) {
    const minutes = Math.max(1, Math.ceil((body.retryAfterSeconds ?? 60) / 60));
    throw new SystemAdminError('LOCKED', `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  if (res.status === 503) throw new SystemAdminError('NOT_SET_UP', 'System admin sign-in is not set up on this server yet.');
  if (res.status === 400) throw new SystemAdminError('WRONG', 'Enter the email and password.');
  throw new SystemAdminError('FAILED', `The server responded ${res.status}.`);
}

async function authorised(path, init = {}) {
  const session = await loadStoredSession();
  const res = await fetch(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${session?.token ?? ''}` },
  });
  if (res.status === 401) throw new SystemAdminError('UNAUTHORIZED', 'Your system admin sign-in has ended. Sign in again.');
  return res;
}

/** @returns {Promise<{schools: object[], counts: Record<string, number>}>} */
export async function getAllSchools() {
  const res = await authorised('/api/system-admin/schools');
  if (!res.ok) throw new SystemAdminError('FAILED', `The server responded ${res.status}.`);
  const { schools, counts } = await res.json();
  return { schools, counts: counts ?? {} };
}

// Why a status change was refused, in words a system admin can act on.
const REFUSED = {
  400: 'The request was not accepted. A rejection needs a reason.',
  404: 'This school no longer exists on the server.',
  409: 'This school changed since the list loaded. Refresh and try again.',
};

async function review(schoolId, action, { note } = {}) {
  const res = await authorised(`/api/system-admin/schools/${encodeURIComponent(schoolId)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note?.trim() ? { note: note.trim() } : {}),
  });
  if (!res.ok) throw new SystemAdminError('FAILED', REFUSED[res.status] ?? `The server responded ${res.status}.`);
  return res.json();
}

export const approveSchool = (schoolId, opts) => review(schoolId, 'approve', opts);
export const rejectSchool = (schoolId, opts) => review(schoolId, 'reject', opts);
export const disableSchool = (schoolId, opts) => review(schoolId, 'disable', opts);
export const enableSchool = (schoolId, opts) => review(schoolId, 'enable', opts);
