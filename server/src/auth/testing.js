// Test helpers: a system admin account and a signed-in fetch for route tests.
import { createSystemAdminAuth, hashPassword } from './systemAdminAuth.js';
import { createUserAuth } from './userAuth.js';
import { createUser } from '../db/repository.js';

export const TEST_ADMIN = { username: 'sysadmin', password: 'correct horse battery' };

// Hashing is deliberately slow, so do it once per test file.
const TEST_HASH = hashPassword(TEST_ADMIN.password);

export function testSystemAdminAuth(overrides = {}) {
  return createSystemAdminAuth({ username: TEST_ADMIN.username, passwordHash: TEST_HASH, tokenSecret: 'test-secret', ...overrides });
}

/** Sign in against a running test server and return the token. */
export async function signInSystemAdmin(base) {
  const res = await fetch(`${base}/api/system-admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(TEST_ADMIN),
  });
  if (!res.ok) throw new Error(`test sign-in failed: ${res.status}`);
  return (await res.json()).token;
}

/** Staff sign-in for route tests, with a fixed secret. */
export function testUserAuth(db, overrides = {}) {
  return createUserAuth({ db, tokenSecret: 'test-user-secret', ...overrides });
}

/**
 * Create a school admin or teacher in `schoolId` (which must exist) and return
 * the headers a signed-in request from them carries.
 */
export function staffHeaders(db, userAuth, { schoolId, role = 'admin', email } = {}) {
  const user = createUser(db, {
    email: email ?? `${role}-${Math.random().toString(36).slice(2, 8)}@${schoolId}.test`,
    fullName: `Test ${role}`,
    role,
    schoolId,
    passwordHash: TEST_HASH,
  });
  const { token } = userAuth.issueToken(user);
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}
