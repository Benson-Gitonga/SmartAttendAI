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

/** Invite a teacher. Returns { teacher, code, expiresAt, purpose }; the code is shown only now. */
export function inviteTeacher(schoolId, { fullName, email, phone }) {
  return request(`${school(schoolId)}/teachers`, {
    method: 'POST',
    body: { fullName, email, ...(phone ? { phone } : {}) },
  });
}

/** A new one-time code: a fresh invite, or a password reset for a teacher who has signed in. */
export function newTeacherCode(userId) {
  return request(`/api/admin/teachers/${encodeURIComponent(userId)}/code`, { method: 'POST', body: {} });
}

export function setTeacherEnabled(userId, enabled) {
  return request(`/api/admin/teachers/${encodeURIComponent(userId)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST', body: {} });
}

/** Students of the school, or of one class: [{ studentId, fullName, admissionNo, classGroupId, className, cardUid, active, ... }] */
export async function getStudents(schoolId, { classId = null, includeInactive = false } = {}) {
  const query = new URLSearchParams();
  if (classId) query.set('classId', classId);
  if (includeInactive) query.set('inactive', '1');
  const qs = query.toString();
  const { students } = await request(`${school(schoolId)}/students${qs ? `?${qs}` : ''}`);
  return students;
}

/** Enrol one student; they get a card number at once. */
export function enrolStudent(classGroupId, { fullName, admissionNo, guardianPhone, guardianEmail }) {
  const clean = Object.fromEntries(Object.entries({ fullName, admissionNo, guardianPhone, guardianEmail })
    .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    .filter(([, v]) => v));
  return request(`${klass(classGroupId)}/students`, { method: 'POST', body: clean });
}

/** Enrol a whole class list at once. All or nothing; a bad row comes back as an error naming the row. */
export async function importStudents(classGroupId, students) {
  const { students: created } = await request(`${klass(classGroupId)}/students/import`, { method: 'POST', body: { students } });
  return created;
}

/** Edit, move (`classGroupId`), remove (`active: false`) or restore a student. */
export function updateStudent(studentId, patch) {
  return request(`/api/admin/students/${encodeURIComponent(studentId)}`, { method: 'PATCH', body: patch });
}

/** A replacement card: the old number stops working. */
export function reissueCard(studentId) {
  return request(`/api/admin/students/${encodeURIComponent(studentId)}/card`, { method: 'POST', body: {} });
}

/**
 * One card read at the scan station. Resolves to { outcome: 'recorded'|'duplicate', student, mark }
 * or, for a card the school does not know, { outcome: 'unknown-card', cardUid }.
 */
export async function stationScan(cardUid) {
  try {
    return await request('/api/admin/scan', { method: 'POST', body: { cardUid } });
  } catch (err) {
    if (err.status === 404) return { outcome: 'unknown-card', cardUid };
    throw err;
  }
}
