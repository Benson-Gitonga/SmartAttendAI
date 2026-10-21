/**
 * Sign-in against the SmartAttend server (server/src/auth/userAuth.js), which
 * holds every school admin and teacher account. This replaced the Amazon
 * Cognito sign-in: the same email and password work on any device, and the
 * server, not the device, decides whether a password is right.
 *
 * The session kept on the device is the server's pass (`token`), sent with
 * every request. It lasts weeks, so the app opens offline and records queued
 * offline can still be sent; it is renewed whenever the app is online
 * (refreshSession), so someone who uses the app regularly stays signed in.
 * There is no device lock or PIN: the phone's own screen lock does that job.
 */

import { db } from '../db/database';

export const SESSION_KEY = 'session';

/** Renew the token at most this often. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

export class AuthError extends Error {
  /** @param {string} code e.g. WRONG, LOCKED, DISABLED, NETWORK, CONFLICT, INVALID_INPUT */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export function isSessionValid(session, now = Date.now()) {
  const expiresAt = session?.tokenExpiresAt ?? session?.expiresAt;
  return typeof expiresAt === 'number' && expiresAt > now;
}

async function persist(session) {
  await db.authState.put(session);
  return session;
}

/** The session as kept on the device, from the server's sign-in reply. */
function sessionFromServer({ token, expiresAt, user, school }, now = Date.now()) {
  return {
    key: SESSION_KEY,
    mode: 'server',
    userId: user.userId,
    username: user.email,
    displayName: user.fullName,
    jobTitle: user.jobTitle ?? null,
    role: user.role,
    roles: [user.role],
    schoolId: user.schoolId,
    schoolName: school?.name ?? null,
    schoolStatus: school?.status ?? null,
    token,
    tokenExpiresAt: expiresAt,
    expiresAt,
    issuedAt: now,
  };
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

async function postJson(path, body, fetchImpl) {
  try {
    const res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { res, json: await res.json().catch(() => ({})) };
  } catch {
    throw new AuthError('NETWORK', 'Could not reach the SmartAttend server. Check your connection and try again.');
  }
}

/**
 * @throws {AuthError} INVALID_INPUT | NETWORK | WRONG | LOCKED | DISABLED | INVITED | FAILED
 */
export async function signIn(email, password, { fetchImpl = globalThis.fetch } = {}) {
  if (!email?.trim() || !password) throw new AuthError('INVALID_INPUT', 'Enter your email and password.');
  if (offline()) {
    throw new AuthError('NETWORK', 'You are offline. Sign in once with a connection; after that SmartAttend opens offline.');
  }

  const { res, json } = await postJson('/api/auth/login', { email: email.trim(), password }, fetchImpl);
  if (res.ok) return persist(sessionFromServer(json));

  if (res.status === 429) {
    const minutes = Math.max(1, Math.ceil((json.retryAfterSeconds ?? 60) / 60));
    throw new AuthError('LOCKED', `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  if (res.status === 401) throw new AuthError('WRONG', 'Wrong email or password.');
  if (res.status === 403) throw new AuthError(json.reason === 'invited' ? 'INVITED' : 'DISABLED', json.error ?? 'This account cannot sign in.');
  if (res.status === 400) throw new AuthError('INVALID_INPUT', json.error ?? 'Enter your email and password.');
  throw new AuthError('FAILED', `The server could not sign you in (${res.status}).`);
}

/**
 * Send a school's application. Nobody is signed in: the applicant confirms
 * their email from the link sent now, and sets a password from the link sent
 * when the school is approved.
 *
 * @param {{school: object, applicant: object}} application see server schemas/schoolRegistration.schema.js
 * @returns {Promise<{school: object, email: string, emailSent: boolean}>}
 * @throws {AuthError} NETWORK | CONFLICT (with `field`) | INVALID_INPUT | FAILED
 */
export async function registerSchool(application, { fetchImpl = globalThis.fetch } = {}) {
  if (offline()) throw new AuthError('NETWORK', 'Connect to the internet to send your application.');

  const { res, json } = await postJson('/api/schools/register', application, fetchImpl);
  if (res.ok) return json;

  if (res.status === 409) throw new AuthError('CONFLICT', json.error ?? 'This school or email is already registered.', { field: json.field });
  if (res.status === 400) {
    throw new AuthError('INVALID_INPUT', 'Some details are not valid. Check the school code, email and phone number.');
  }
  throw new AuthError('FAILED', `The server could not take the application (${res.status}).`);
}

/**
 * What an emailed link is for: { purpose: 'verify_email'|'setup'|'reset',
 * email, fullName, role, schoolName, schoolStatus, expiresAt }.
 * @throws {AuthError} LINK (with `state`: unknown|used|revoked|expired) | LOCKED | NETWORK
 */
export async function lookupEmailLink(token, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`/api/auth/links/${encodeURIComponent(token)}`);
  } catch {
    throw new AuthError('NETWORK', 'Could not reach the SmartAttend server. Check your connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json;
  if (res.status === 429) throw new AuthError('LOCKED', json.error ?? 'Too many tries. Wait a few minutes.');
  throw new AuthError('LINK', json.error ?? 'This link is not valid.', { state: json.state ?? 'unknown' });
}

/** Confirm the applicant's email. Returns { email, schoolName, schoolStatus }. */
export async function verifyEmail(token, { fetchImpl = globalThis.fetch } = {}) {
  const { res, json } = await postJson('/api/auth/verify-email', { token }, fetchImpl);
  if (res.ok) return json;
  if (res.status === 429) throw new AuthError('LOCKED', json.error ?? 'Too many tries. Wait a few minutes.');
  throw new AuthError('LINK', json.error ?? 'This link is not valid.', { state: json.state ?? 'unknown' });
}

/** Set the first password (set-up link) or a new one (reset link), and sign in. */
export async function setPasswordWithLink(token, password, { fetchImpl = globalThis.fetch } = {}) {
  if (offline()) throw new AuthError('NETWORK', 'Connect to the internet to set your password.');
  const { res, json } = await postJson('/api/auth/set-password', { token, password }, fetchImpl);
  if (res.ok) return persist(sessionFromServer(json));
  if (res.status === 429) throw new AuthError('LOCKED', json.error ?? 'Too many tries. Wait a few minutes.');
  if (res.status === 400 && !json.state) throw new AuthError('INVALID_INPUT', json.error ?? 'Choose a password of at least 8 characters.');
  throw new AuthError('LINK', json.error ?? 'This link does not work.', { state: json.state ?? 'unknown' });
}

/** "Forgot password": the server answers the same whether or not the email has an account. */
export async function requestPasswordHelp(email, { fetchImpl = globalThis.fetch } = {}) {
  if (offline()) throw new AuthError('NETWORK', 'Connect to the internet first.');
  const { res, json } = await postJson('/api/auth/forgot-password', { email: email.trim() }, fetchImpl);
  if (res.ok) return json.message;
  if (res.status === 429) throw new AuthError('LOCKED', json.error ?? 'Too many requests. Wait a few minutes, then try again.');
  if (res.status === 400) throw new AuthError('INVALID_INPUT', json.error ?? 'Enter the email address you sign in with.');
  throw new AuthError('FAILED', `The server could not send the email (${res.status}).`);
}

/**
 * Who a one-time code from the school admin is for: { fullName, email,
 * schoolName, purpose: 'invite'|'reset', expiresAt }.
 * @throws {AuthError} CODE (with `state`: unknown|used|revoked|expired) | LOCKED | NETWORK
 */
export async function lookupSetupCode(code, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`/api/auth/setup-codes/${encodeURIComponent(code.trim())}`);
  } catch {
    throw new AuthError('NETWORK', 'Could not reach the SmartAttend server. Check your connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json;
  if (res.status === 429) throw new AuthError('LOCKED', json.error ?? 'Too many wrong codes. Try again in a few minutes.');
  throw new AuthError('CODE', json.error ?? 'That code is not right.', { state: json.state ?? 'unknown' });
}

/** Set a password with the code and sign straight in. */
export async function redeemSetupCode(code, password, { fetchImpl = globalThis.fetch } = {}) {
  if (offline()) throw new AuthError('NETWORK', 'Connect to the internet to finish setting up your account.');
  const { res, json } = await postJson('/api/auth/setup', { code: code.trim(), password }, fetchImpl);
  if (res.ok) return persist(sessionFromServer(json));
  if (res.status === 429) throw new AuthError('LOCKED', json.error ?? 'Too many wrong codes. Try again in a few minutes.');
  if (res.status === 400) throw new AuthError('INVALID_INPUT', json.error ?? 'Choose a password of at least 8 characters.');
  throw new AuthError('CODE', json.error ?? 'That code does not work.', { state: json.state ?? 'unknown' });
}

export async function loadStoredSession() {
  const session = (await db.authState.get(SESSION_KEY)) ?? null;
  if (!session) return null;
  // Only sessions the server issued count. Older builds kept device-only
  // accounts (Cognito "local mode"), and those are dropped here.
  const fromServer = (session.mode === 'server' || session.mode === 'system_admin') && Boolean(session.token);
  if (!fromServer) {
    await db.authState.delete(SESSION_KEY);
    return null;
  }
  return session;
}

/**
 * Keep the system admin's server-issued sign-in on the device. The token is
 * what the server checks; the role here only picks which screen to show.
 */
export async function saveSystemAdminSession({ token, username, expiresAt }, now = Date.now()) {
  return persist({
    key: SESSION_KEY,
    mode: 'system_admin',
    username,
    displayName: 'System admin',
    roles: ['system_admin'],
    role: 'system_admin',
    schoolId: null,
    schoolName: null,
    token,
    tokenExpiresAt: expiresAt,
    expiresAt,
    issuedAt: now,
  });
}

/** Refresh what the device knows about the user's school (e.g. once approved). */
export async function updateStoredSchool(school) {
  const session = await loadStoredSession();
  if (!session || !school) return session;
  return persist({ ...session, schoolName: school.name ?? session.schoolName, schoolStatus: school.status ?? session.schoolStatus });
}

/**
 * Swap the stored token for a fresh one while online, so a regular user's
 * sign-in never runs out. Does nothing offline or if renewed recently.
 *
 * @returns {Promise<{status: 'renewed'|'skipped'|'offline'|'signed_out', session?: object}>}
 *   'signed_out' when the server no longer accepts the token (account
 *   disabled, or it ran out): the caller should sign out.
 */
export async function refreshSession({ fetchImpl = globalThis.fetch, now = Date.now(), force = false } = {}) {
  const session = await loadStoredSession();
  if (!session || session.mode !== 'server') return { status: 'skipped' };
  if (!force && now - (session.issuedAt ?? 0) < REFRESH_AFTER_MS) return { status: 'skipped' };
  if (offline()) return { status: 'offline' };

  let res;
  try {
    res = await fetchImpl('/api/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } });
  } catch {
    return { status: 'offline' };
  }
  if (res.status === 401) return { status: 'signed_out' };
  if (!res.ok) return { status: 'skipped' };
  const next = await persist(sessionFromServer(await res.json(), now));
  return { status: 'renewed', session: next };
}

export async function signOut() {
  await db.authState.delete(SESSION_KEY);
}

/** Headers that sign a request to the SmartAttend API as the stored session. */
export async function authHeaders() {
  const session = await loadStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}
