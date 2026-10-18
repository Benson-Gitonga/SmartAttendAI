import {
  CognitoUserPool,
  CognitoUser,
  CognitoUserAttribute,
  AuthenticationDetails
} from 'amazon-cognito-identity-js';
import { db, LOCAL_SCHOOL_ID } from '../db/database';
import { AuthError, signInError, signUpError, confirmError, resendError } from './authErrors';
import { savePendingSignup, clearPendingSignup } from './pendingSignup';

export { AuthError };

/**
 * Amazon Cognito authentication. Without VITE_COGNITO_USER_POOL_ID and
 * VITE_COGNITO_CLIENT_ID it issues local sessions (mode: 'local') that AWS
 * never accepts.
 */

const USER_POOL_ID = import.meta.env?.VITE_COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = import.meta.env?.VITE_COGNITO_CLIENT_ID ?? '';

export const SESSION_KEY = 'session';
const LOCAL_TOKEN_TTL_MS = 60 * 60 * 1000;

export function isCognitoConfigured() {
  return Boolean(USER_POOL_ID && CLIENT_ID);
}

let poolInstance = null;
function userPool() {
  if (!isCognitoConfigured()) return null;
  if (!poolInstance) {
    poolInstance = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID });
  }
  return poolInstance;
}

/** Reads a JWT payload without verifying it. */
export function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function sessionFromCognito(cognitoSession, username) {
  const idToken = cognitoSession.getIdToken();
  const claims = idToken.decodePayload();
  return {
    key: SESSION_KEY,
    mode: 'cognito',
    username,
    displayName: claims.name ?? claims.email ?? username,
    roles: claims['cognito:groups'] ?? ['teacher'],
    idToken: idToken.getJwtToken(),
    refreshToken: cognitoSession.getRefreshToken().getToken(),
    expiresAt: claims.exp * 1000,
    issuedAt: Date.now()
  };
}

/**
 * @param {'teacher'|'admin'|'system_admin'} role
 * @param {string|null} schoolId a school admin's registered school; everyone
 *   else shares the single local school.
 */
function localSession(username, displayName, role = 'teacher', schoolName = null, schoolId = null, now = Date.now()) {
  return {
    key: SESSION_KEY,
    mode: 'local',
    username,
    displayName: displayName || username,
    roles: [role],
    role,
    schoolId: schoolId || LOCAL_SCHOOL_ID,
    schoolName: schoolName || null,
    idToken: null,
    refreshToken: null,
    expiresAt: now + LOCAL_TOKEN_TTL_MS,
    issuedAt: now
  };
}

// Local-mode profiles (name, role, school) keyed by email. No passwords are stored.
const accountKey = (email) => `account:${String(email).trim().toLowerCase()}`;

async function saveLocalAccount(email, displayName, role = 'teacher', schoolName = null, schoolId = null) {
  await db.authState.put({
    key: accountKey(email),
    email: String(email).trim().toLowerCase(),
    displayName,
    role,
    schoolName,
    schoolId,
    createdAt: new Date().toISOString()
  });
}

async function loadLocalAccount(email) {
  return (await db.authState.get(accountKey(email))) ?? null;
}

export function isSessionValid(session, now = Date.now()) {
  return Boolean(session) && typeof session.expiresAt === 'number' && session.expiresAt > now;
}

async function persist(session) {
  await db.authState.put(session);
  return session;
}

/**
 * @throws {AuthError} NOT_AUTHORIZED | NOT_CONFIRMED | NEW_PASSWORD_REQUIRED | NETWORK
 */
export async function signIn(username, password) {
  if (!username || !password) {
    throw new AuthError('INVALID_INPUT', 'Enter both a username and a password');
  }

  const pool = userPool();
  if (!pool) {
    const account = await loadLocalAccount(username);
    return persist(localSession(username, account?.displayName, account?.role, account?.schoolName, account?.schoolId));
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AuthError('NETWORK', 'No connection - sign in with your offline PIN instead');
  }

  const user = new CognitoUser({ Username: username, Pool: pool });
  const details = new AuthenticationDetails({ Username: username, Password: password });

  const cognitoSession = await new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: resolve,
      onFailure: (err) => reject(signInError(err)),
      newPasswordRequired: () =>
        reject(new AuthError('NEW_PASSWORD_REQUIRED', 'A new password is required for this account'))
    });
  });

  return persist(sessionFromCognito(cognitoSession, username));
}

/**
 * Local mode signs in straight away. Cognito mode emails a code that must be
 * passed to confirmSignUp(), and remembers the email on the device until then.
 *
 * @param {'teacher'|'admin'|'system_admin'} [role] local mode only
 * @param {string|null} [schoolId] the school a school admin just registered
 * @throws {AuthError} INVALID_INPUT | NETWORK | ACCOUNT_EXISTS | SIGNUP_FAILED
 */
export async function signUp({ name, email, password, role = 'teacher', schoolName = null, schoolId = null }) {
  const displayName = name?.trim();
  const username = email?.trim();

  if (!displayName || !username || !password) {
    throw new AuthError('INVALID_INPUT', 'Enter your name, email and a password');
  }
  if (password.length < 8) {
    throw new AuthError('INVALID_INPUT', 'Password must be at least 8 characters');
  }

  const pool = userPool();
  if (!pool) {
    await saveLocalAccount(username, displayName, role, schoolName, schoolId);
    const session = await persist(localSession(username, displayName, role, schoolName, schoolId));
    return { needsConfirmation: false, session };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AuthError('NETWORK', 'Connect to the internet to create an account');
  }

  const attributes = [
    new CognitoUserAttribute({ Name: 'email', Value: username }),
    new CognitoUserAttribute({ Name: 'name', Value: displayName })
  ];

  await new Promise((resolve, reject) => {
    pool.signUp(username, password, attributes, [], (err, result) => {
      if (err) reject(signUpError(err));
      else resolve(result);
    });
  });

  await savePendingSignup(username);
  return { needsConfirmation: true, username };
}

/**
 * Confirm a Cognito sign-up with the emailed code, then sign in if the
 * password is known. Returns null when it is not (the app was reopened since
 * sign-up), and the caller should ask the teacher to sign in.
 * @throws {AuthError} INVALID_INPUT | NETWORK | CODE_EXPIRED | CODE_MISMATCH | TOO_MANY_ATTEMPTS | CONFIRM_FAILED
 */
export async function confirmSignUp(username, code, password) {
  const pool = userPool();
  if (!pool) {
    return signIn(username, password);
  }
  if (!username || !code) {
    throw new AuthError('INVALID_INPUT', 'Enter the verification code from your email');
  }

  const user = new CognitoUser({ Username: username.trim(), Pool: pool });
  await new Promise((resolve, reject) => {
    user.confirmRegistration(code.trim(), true, (err, result) => {
      const failure = err ? confirmError(err) : null;
      if (failure) reject(failure);
      else resolve(result);
    });
  });

  await clearPendingSignup();
  if (password) return signIn(username, password);
  return null;
}

export async function resendConfirmationCode(username) {
  const pool = userPool();
  if (!pool) return;
  const user = new CognitoUser({ Username: username.trim(), Pool: pool });
  await new Promise((resolve, reject) => {
    user.resendConfirmationCode((err, result) => {
      if (err) reject(resendError(err));
      else resolve(result);
    });
  });
}

export async function loadStoredSession() {
  return (await db.authState.get(SESSION_KEY)) ?? null;
}

/** Extend the session after a PIN unlock. This does not refresh the AWS token. */
export async function extendSessionWithPin(session, now = Date.now()) {
  return persist({
    ...session,
    key: SESSION_KEY,
    pinVerified: true,
    expiresAt: now + LOCAL_TOKEN_TTL_MS,
    idTokenExpired: session.mode === 'cognito'
  });
}

export async function signOut() {
  const pool = userPool();
  const session = await loadStoredSession();
  if (pool && session?.username) {
    new CognitoUser({ Username: session.username, Pool: pool }).signOut();
  }
  await db.authState.delete(SESSION_KEY);
}

/** Dev helper: mark the stored session as expired. */
export async function expireSessionNow() {
  const session = await loadStoredSession();
  if (!session) return null;
  return persist({ ...session, expiresAt: Date.now() - 1000, pinVerified: false });
}
