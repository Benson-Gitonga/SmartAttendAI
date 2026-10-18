/**
 * The classes the school admin assigned this teacher, downloaded from the
 * server (GET /api/teacher/classes) and saved on the device so they work
 * offline. Run on sign-in and whenever the app comes back online.
 */

import { authHeaders } from '../auth/session';
import { applyAssignedClasses } from '../db/database';

/**
 * @returns {Promise<{status: 'ok'|'offline'|'unauthorized'|'error', classes?: number, removed?: number}>}
 */
export async function syncAssignedClasses(ownerUsername, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl('/api/teacher/classes', { headers: await authHeaders() });
  } catch {
    return { status: 'offline' };
  }
  if (res.status === 401) return { status: 'unauthorized' };
  if (!res.ok) return { status: 'error' };

  const { classes } = await res.json();
  const saved = await applyAssignedClasses(classes ?? [], ownerUsername);
  return { status: 'ok', classes: saved.classes, removed: saved.removed };
}
