/** Fetch wrappers for server/src/routes/admin.js. Admin data is always fetched live. */

import { authHeaders } from '../auth/session';

export class AdminApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AdminApiError('Could not reach the SmartAttend server. Check your connection.', { code: 'NETWORK' });
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AdminApiError('Your sign-in has ended. Sign in again.', { status: 401, code: 'UNAUTHORIZED' });
  if (!res.ok) throw new AdminApiError(json.error ?? `${path} responded ${res.status}`, { status: res.status });
  return json;
}

const school = (schoolId) => `/api/admin/schools/${encodeURIComponent(schoolId)}`;
const klass = (classGroupId) => `/api/admin/classes/${encodeURIComponent(classGroupId)}`;
const dateQuery = (date) => (date ? `?date=${encodeURIComponent(date)}` : '');

export function getSchoolOverview(schoolId) {
  return request(`${school(schoolId)}/overview`);
}

/** Every class's register for a day: { date, totals, classes }. */
export function getRegisterBoard(schoolId, date) {
  return request(`${school(schoolId)}/today${dateQuery(date)}`);
}

export async function getSchoolClasses(schoolId) {
  const { classes } = await request(`${school(schoolId)}/classes`);
  return classes;
}

export function createClass(schoolId, { grade, stream, teacherUserId }) {
  return request(`${school(schoolId)}/classes`, {
    method: 'POST',
    body: { grade, ...(stream ? { stream } : {}), ...(teacherUserId ? { teacherUserId } : {}) },
  });
}

/** Rename a class or change its teacher; `teacherUserId: null` unassigns. */
export function updateClass(classGroupId, patch) {
  return request(klass(classGroupId), { method: 'PATCH', body: patch });
}

export async function getTeachers(schoolId) {
  const { teachers } = await request(`${school(schoolId)}/teachers`);
  return teachers;
}

export function getClassStudents(classGroupId) {
  return request(`${klass(classGroupId)}/students`);
}

/** { class, date, students: [{ studentId, fullName, admissionNo, mark, override }] } */
export function getClassRegister(classGroupId, date) {
  return request(`${klass(classGroupId)}/register${dateQuery(date)}`);
}

/**
 * Take or correct a register.
 * @param {{date: string, reason: string, note?: string, marks: {studentId, status, absenceReason?}[]}} body
 */
export function saveClassRegister(classGroupId, body) {
  return request(`${klass(classGroupId)}/register`, { method: 'PUT', body });
}

export async function getSchoolFlagged(schoolId) {
  const { flagged } = await request(`${school(schoolId)}/flagged`);
  return flagged;
}
