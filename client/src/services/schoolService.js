/**
 * Fetch wrappers for server/src/routes/schools.js: a school admin registers
 * their school and checks whether a system admin has approved it.
 */

export class SchoolServiceError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'SchoolServiceError';
    this.status = status;
    this.body = body;
  }
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

/**
 * @param {{name:string, county?:string, adminName:string, adminEmail:string, adminPhone?:string}} details
 * @returns {Promise<{schoolId:string, name:string, county:string|null, status:string}>}
 */
export async function registerSchool(details, { fetchImpl = globalThis.fetch } = {}) {
  const body = Object.fromEntries(
    Object.entries(details).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  );

  let res;
  try {
    res = await fetchImpl('/api/schools/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SchoolServiceError('Could not reach the SmartAttend server. Check your connection and try again.');
  }

  const json = await readJson(res);
  if (res.status === 409) {
    throw new SchoolServiceError(
      'This school is already registered. Ask the admin who registered it to add you, or contact SmartAttend support.',
      { status: 409, body: json }
    );
  }
  if (res.status === 400) {
    throw new SchoolServiceError('Check the school details: the name, email or phone number is not valid.', { status: 400, body: json });
  }
  if (!res.ok) throw new SchoolServiceError(`The server could not register the school (${res.status}).`, { status: res.status, body: json });
  return json;
}

/** The school's current status, or null when the server does not know it. */
export async function getSchoolStatus(schoolId, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`/api/schools/${encodeURIComponent(schoolId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new SchoolServiceError(`school status responded ${res.status}`, { status: res.status });
  return res.json();
}
