import { db } from '../db/database';

/**
 * A sign-up still waiting for its email code. Saved on the device so closing
 * the app (common while waiting for the email on a weak connection) brings the
 * teacher back to the verify screen. Only the email is kept, never the password.
 */

const KEY = 'pendingSignup';
const normalise = (email) => String(email).trim().toLowerCase();

export async function savePendingSignup(email, now = new Date()) {
  await db.authState.put({ key: KEY, email: normalise(email), createdAt: now.toISOString() });
}

/** @returns {Promise<{email: string, createdAt: string}|null>} */
export async function loadPendingSignup() {
  const row = await db.authState.get(KEY);
  return row ? { email: row.email, createdAt: row.createdAt } : null;
}

export async function clearPendingSignup() {
  await db.authState.delete(KEY);
}
