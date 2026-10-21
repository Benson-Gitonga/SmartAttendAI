/**
 * The classes the school admin assigned this teacher, downloaded from the
 * server (GET /api/teacher/classes) and saved on the device so they work
 * offline. Run on sign-in and whenever the app comes back online.
 */

import { authHeaders } from '../auth/session';
import { applyAssignedClasses, applyServerAttendance } from '../db/database';

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
  let records = 0;
  for (const c of classes ?? []) {
    records += await syncClassAttendance(c.classGroupId, { fetchImpl });
  }
  return { status: 'ok', classes: saved.classes, removed: saved.removed, records };
}

/**
 * Download a class's recent attendance (the server keeps about four months
 * for this) so the history the at-risk list needs is on the phone. A failure
 * here is not fatal: the class still works, with the history it already has.
 *
 * @returns {Promise<number>} records added or changed
 */
export async function syncClassAttendance(classGroupId, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(`/api/teacher/classes/${encodeURIComponent(classGroupId)}/attendance`, { headers: await authHeaders() });
    if (!res.ok) return 0;
    const { records = [] } = await res.json();
    const { added, updated } = await applyServerAttendance(records);
    return added + updated;
  } catch {
    return 0;
  }
}
