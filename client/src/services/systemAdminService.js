/** Fetch wrappers for server/src/routes/systemAdmin.js. */

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
}

/** @returns {Promise<{schools: object[], counts: Record<string, number>}>} */
export async function getAllSchools() {
  const { schools, counts } = await getJson('/api/system-admin/schools');
  return { schools, counts: counts ?? {} };
}

// Why a status change was refused, in words a system admin can act on.
const REFUSED = {
  400: 'The request was not accepted. A rejection needs a reason.',
  404: 'This school no longer exists on the server.',
  409: 'This school changed since the list loaded. Refresh and try again.',
};

async function review(schoolId, action, { note, actor } = {}) {
  const body = {};
  if (note?.trim()) body.note = note.trim();
  if (actor) body.actor = actor;

  const res = await fetch(`/api/system-admin/schools/${encodeURIComponent(schoolId)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(REFUSED[res.status] ?? `The server responded ${res.status}.`);
  return res.json();
}

export const approveSchool = (schoolId, opts) => review(schoolId, 'approve', opts);
export const rejectSchool = (schoolId, opts) => review(schoolId, 'reject', opts);
export const disableSchool = (schoolId, opts) => review(schoolId, 'disable', opts);
export const enableSchool = (schoolId, opts) => review(schoolId, 'enable', opts);
