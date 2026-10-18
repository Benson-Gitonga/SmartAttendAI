// Test helpers: a system admin account and a signed-in fetch for route tests.
import { createSystemAdminAuth, hashPassword } from './systemAdminAuth.js';

export const TEST_ADMIN = { email: 'ops@smartattend.test', password: 'correct horse battery' };

// Hashing is deliberately slow, so do it once per test file.
const TEST_HASH = hashPassword(TEST_ADMIN.password);

export function testSystemAdminAuth(overrides = {}) {
  return createSystemAdminAuth({ email: TEST_ADMIN.email, passwordHash: TEST_HASH, tokenSecret: 'test-secret', ...overrides });
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
