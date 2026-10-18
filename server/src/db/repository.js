import { randomUUID } from 'node:crypto';
import { assessStudent, flagRank, FOLLOW_UP_FRESH_DAYS } from '../lib/riskModel.js';

/** Local calendar date as YYYY-MM-DD. Matches the client's todayISO(). */
export function todayISO(now = new Date()) {
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split('T')[0];
}

export class DuplicateAttendanceError extends Error {
  constructor(studentId, date) {
    super(`Attendance already recorded for ${studentId} on ${date}`);
    this.name = 'DuplicateAttendanceError';
    this.studentId = studentId;
    this.date = date;
  }
}

const isUniqueViolation = (err) =>
  err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY');

/** The active student holding this card, or null. */
export function findStudentByCardUid(db, cardUid) {
  return db
    .prepare(
      `SELECT s.student_id, s.full_name, s.admission_no, s.class_group_id, c.card_uid
         FROM rfid_cards c
         JOIN students s ON s.student_id = c.student_id
        WHERE c.card_uid = ? AND c.active = 1`
    )
    .get(cardUid) ?? null;
}

export function hasAttendanceForDate(db, studentId, date = todayISO()) {
  return !!db.prepare('SELECT 1 FROM attendance_events WHERE student_id = ? AND date = ?').get(studentId, date);
}

/**
 * Write one attendance record, its sync-queue entry and an audit row in a
 * single transaction.
 *
 * @throws {DuplicateAttendanceError}
 */
export function recordAttendance(db, event) {
  const {
    studentId,
    date = todayISO(),
    status = 'present',
    captureMethod,
    verified = 0,
    recordedBy = null,
    source = 'simulation',
    eventId = randomUUID(),
    // When it actually happened, if not now (an offline gate scan sent later).
    createdAt = null,
  } = event;

  if (!studentId) throw new Error('studentId is required');
  if (!['present', 'absent', 'late'].includes(status)) throw new Error(`bad status: ${status}`);
  if (!['manual', 'rfid', 'fingerprint', 'import'].includes(captureMethod)) {
    throw new Error(`bad captureMethod: ${captureMethod}`);
  }

  const createdIso = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO attendance_events
           (event_id, student_id, date, status, capture_method, verified, recorded_by, source, created_at)
         VALUES (@eventId, @studentId, @date, @status, @captureMethod, @verified, @recordedBy, @source, @createdAtSql)`
      )
      .run({
        eventId,
        studentId,
        date,
        status,
        captureMethod,
        verified: verified ? 1 : 0,
        recordedBy,
        source,
        createdAtSql: toSqliteTimestamp(createdIso),
      });

    // createdAt must be RFC3339, so it is generated here rather than by SQLite.
    const payload = JSON.stringify({
      eventId,
      studentId,
      date,
      status,
      captureMethod,
      recordedBy,
      createdAt: createdIso,
    });
    db.prepare(`INSERT INTO sync_queue (event_id, payload, status) VALUES (?, ?, 'pending')`).run(
      eventId,
      payload
    );

    db.prepare(
      `INSERT INTO audit_log (action, actor_id, record_id, detail)
       VALUES ('attendance.recorded', @recordedBy, @eventId, @detail)`
    ).run({
      recordedBy,
      eventId,
      detail: JSON.stringify({ studentId, date, status, captureMethod, verified: !!verified, source }),
    });

    return { id: info.lastInsertRowid, eventId, studentId, date, status, captureMethod, verified: !!verified, source, createdAt: createdIso };
  });

  try {
    return tx();
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateAttendanceError(studentId, date);
    throw err;
  }
}

export function logFingerprintChallenge(db, { studentId, cardUid, eventId = null, result, successRate }) {
  const info = db
    .prepare(
      `INSERT INTO fingerprint_challenges (student_id, card_uid, event_id, result, success_rate)
       VALUES (@studentId, @cardUid, @eventId, @result, @successRate)`
    )
    .run({ studentId, cardUid, eventId, result, successRate });
  return { id: info.lastInsertRowid, studentId, cardUid, eventId, result, successRate };
}

export function logAudit(db, { action, actorId = null, recordId = null, detail = null }) {
  db.prepare(
    `INSERT INTO audit_log (action, actor_id, record_id, detail) VALUES (?, ?, ?, ?)`
  ).run(action, actorId, recordId, detail == null ? null : JSON.stringify(detail));
}

export function countPendingSync(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'`).get().n;
}

export function getAttendanceForDate(db, date = todayISO()) {
  return db
    .prepare(
      `SELECT a.*, s.full_name, s.admission_no
         FROM attendance_events a
         JOIN students s ON s.student_id = a.student_id
        WHERE a.date = ?
        ORDER BY a.created_at`
    )
    .all(date);
}

/** SQLite `datetime('now')` ('YYYY-MM-DD HH:MM:SS', UTC) -> RFC3339; ISO strings pass through. */
/** ISO 8601 -> SQLite's datetime('now') format (UTC), so old and new rows sort together. */
function toSqliteTimestamp(iso) {
  return iso.slice(0, 19).replace('T', ' ');
}

function toIsoTimestamp(value) {
  if (value == null) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
}

/**
 * Every attendance record the server holds for one class on one day - gate
 * scans and teacher marks alike - in the camelCase shape the PWA's Dexie
 * `attendanceEvents` rows use, so the phone can store them as-is (keeping the
 * server's eventId, which makes a later push back a harmless duplicate).
 */
export function getClassAttendanceForDate(db, classGroupId, date = todayISO()) {
  return db
    .prepare(
      `SELECT a.event_id AS eventId, a.student_id AS studentId, a.date, a.status,
              a.capture_method AS captureMethod, a.verified, a.recorded_by AS recordedBy,
              a.reason, a.source, a.created_at AS createdAt
         FROM attendance_events a
         JOIN students s ON s.student_id = a.student_id
        WHERE s.class_group_id = ? AND a.date = ?
        ORDER BY a.created_at`
    )
    .all(classGroupId, date)
    .map((r) => ({ ...r, verified: r.verified === 1, createdAt: toIsoTimestamp(r.createdAt) }));
}

/** When the gate hardware last recorded anyone - the phone's "is the gate alive?" signal. */
export function getLastGateScanAt(db) {
  const row = db
    .prepare(`SELECT MAX(created_at) AS at FROM attendance_events WHERE capture_method IN ('rfid', 'fingerprint')`)
    .get();
  return toIsoTimestamp(row.at);
}

export function getRecentChallenges(db, limit = 50) {
  return db
    .prepare(
      `SELECT fc.*, s.full_name
         FROM fingerprint_challenges fc
         JOIN students s ON s.student_id = fc.student_id
        ORDER BY fc.challenged_at DESC, fc.id DESC
        LIMIT ?`
    )
    .all(limit);
}

export function getStats(db, date = todayISO()) {
  const byMethod = db
    .prepare(
      `SELECT capture_method, COUNT(*) AS n FROM attendance_events WHERE date = ? GROUP BY capture_method`
    )
    .all(date);
  const challenges = db
    .prepare(
      `SELECT result, COUNT(*) AS n FROM fingerprint_challenges
        WHERE date(challenged_at, 'localtime') = ? GROUP BY result`
    )
    .all(date);

  const method = Object.fromEntries(byMethod.map((r) => [r.capture_method, r.n]));
  const challenge = Object.fromEntries(challenges.map((r) => [r.result, r.n]));
  const totalAttendance = Object.values(method).reduce((a, b) => a + b, 0);
  const totalChallenges = Object.values(challenge).reduce((a, b) => a + b, 0);

  return {
    date,
    attendanceByMethod: method,
    totalAttendance,
    challenges: { ...challenge, total: totalChallenges },
    pendingSync: countPendingSync(db),
  };
}

// Roster upserts pushed from the PWA. All idempotent so a retry is safe.

export function upsertSchool(db, { schoolId, name, county = null }) {
  db.prepare(
    `INSERT INTO schools (school_id, name, county) VALUES (@schoolId, @name, @county)
     -- A registered school keeps the name and county its admin gave; the PWA
     -- only knows a placeholder name for it.
     ON CONFLICT(school_id) DO UPDATE SET
       name   = CASE WHEN schools.admin_email IS NULL THEN excluded.name ELSE schools.name END,
       county = CASE WHEN schools.admin_email IS NULL THEN excluded.county ELSE coalesce(schools.county, excluded.county) END`
  ).run({ schoolId, name, county });
  return { schoolId, name, county };
}

// Schools: registration by a school admin, review and enable/disable by a
// system admin. A school that is not 'active' cannot push roster changes or
// attendance (see findInactiveSchool).

export const SCHOOL_STATUSES = ['pending', 'active', 'inactive', 'rejected'];

const SCHOOL_COLUMNS = `s.school_id AS schoolId, s.name, s.county, s.status,
  s.admin_name AS adminName, s.admin_email AS adminEmail, s.admin_phone AS adminPhone,
  s.review_note AS reviewNote, s.reviewed_by AS reviewedBy, s.reviewed_at AS reviewedAt,
  s.created_at AS createdAt, s.sub_county AS subCounty, s.school_code AS schoolCode,
  s.school_type AS schoolType, s.boarding, s.student_estimate AS studentEstimate`;

export class SchoolTransitionError extends Error {
  constructor(from, to) {
    super(`a ${from} school cannot be made ${to}`);
    this.name = 'SchoolTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Another school with the same name (any case) in the same county, ignoring rejected ones. */
export function findSchoolByName(db, name, county = null) {
  return (
    db
      .prepare(
        `SELECT ${SCHOOL_COLUMNS} FROM schools s
          WHERE lower(trim(s.name)) = lower(trim(?))
            AND coalesce(lower(s.county), '') = coalesce(lower(?), '')
            AND s.status <> 'rejected'`
      )
      .get(name, county) ?? null
  );
}

export class RegistrationConflictError extends Error {
  /** @param {'email'|'school_code'|'school_name'} field */
  constructor(field, message) {
    super(message);
    this.name = 'RegistrationConflictError';
    this.field = field;
  }
}

/** A non-rejected school with this Ministry of Education code, or null. */
export function findSchoolByCode(db, schoolCode) {
  if (!schoolCode) return null;
  return (
    db
      .prepare(`SELECT ${SCHOOL_COLUMNS} FROM schools s
                 WHERE upper(s.school_code) = upper(trim(?)) AND s.status <> 'rejected'`)
      .get(schoolCode) ?? null
  );
}

/**
 * A school's application: the school waits as 'pending' for a system admin,
 * and the person applying gets an admin account for it straight away, so they
 * can sign in and watch for the decision. Throws RegistrationConflictError when
 * the email already has an account, or the school is already registered.
 *
 * @param {object} school     name, county, subCounty, schoolCode, schoolType, boarding, studentEstimate
 * @param {object} applicant  fullName, email, phone, jobTitle, passwordHash
 */
export function registerSchoolApplication(db, school, applicant) {
  const email = applicant.email.trim().toLowerCase();
  const code = school.schoolCode?.trim().toUpperCase() || null;

  return db.transaction(() => {
    if (findUserByEmail(db, email)) {
      throw new RegistrationConflictError('email', 'an account with this email already exists');
    }
    if (code && findSchoolByCode(db, code)) {
      throw new RegistrationConflictError('school_code', 'a school with this code is already registered');
    }
    if (findSchoolByName(db, school.name, school.county ?? null)) {
      throw new RegistrationConflictError('school_name', 'a school with this name is already registered in this county');
    }

    const schoolId = `school-${randomUUID()}`;
    db.prepare(
      `INSERT INTO schools (school_id, name, county, sub_county, school_code, school_type, boarding,
                            student_estimate, status, admin_name, admin_email, admin_phone)
       VALUES (@schoolId, @name, @county, @subCounty, @code, @schoolType, @boarding,
               @studentEstimate, 'pending', @adminName, @adminEmail, @adminPhone)`
    ).run({
      schoolId,
      name: school.name.trim(),
      county: school.county?.trim() || null,
      subCounty: school.subCounty?.trim() || null,
      code,
      schoolType: school.schoolType ?? null,
      boarding: school.boarding ?? null,
      studentEstimate: school.studentEstimate ?? null,
      adminName: applicant.fullName.trim(),
      adminEmail: email,
      adminPhone: applicant.phone?.trim() || null,
    });

    const user = createUser(db, {
      email,
      fullName: applicant.fullName,
      phone: applicant.phone,
      jobTitle: applicant.jobTitle,
      role: 'admin',
      schoolId,
      passwordHash: applicant.passwordHash,
    });

    logAudit(db, {
      action: 'school.registered',
      actorId: email,
      recordId: schoolId,
      detail: { name: school.name, county: school.county ?? null, schoolCode: code },
    });
    return { school: getSchool(db, schoolId), user };
  })();
}

// School staff accounts. Password hashes never leave this file except to the
// sign-in check (findUserForSignIn).

const USER_COLUMNS = `u.user_id AS userId, u.email, u.full_name AS fullName, u.phone,
  u.job_title AS jobTitle, u.role, u.school_id AS schoolId, u.status,
  u.created_at AS createdAt, u.last_sign_in_at AS lastSignInAt`;

export function createUser(db, { email, fullName, phone = null, jobTitle = null, role, schoolId, passwordHash = null, status = 'active' }) {
  const userId = `user-${randomUUID()}`;
  db.prepare(
    `INSERT INTO users (user_id, email, full_name, phone, job_title, role, school_id, password_hash, status)
     VALUES (@userId, @email, @fullName, @phone, @jobTitle, @role, @schoolId, @passwordHash, @status)`
  ).run({
    userId,
    email: email.trim().toLowerCase(),
    fullName: fullName.trim(),
    phone: phone?.trim() || null,
    jobTitle: jobTitle?.trim() || null,
    role,
    schoolId,
    passwordHash,
    status,
  });
  return getUser(db, userId);
}

export function getUser(db, userId) {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.user_id = ?`).get(userId) ?? null;
}

export function findUserByEmail(db, email) {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.email = trim(?)`).get(String(email)) ?? null;
}

/** The user plus their password hash, for checking a sign-in only. */
export function findUserForSignIn(db, email) {
  return (
    db
      .prepare(`SELECT ${USER_COLUMNS}, u.password_hash AS passwordHash FROM users u WHERE u.email = trim(?)`)
      .get(String(email)) ?? null
  );
}

export function recordSignIn(db, userId) {
  db.prepare(`UPDATE users SET last_sign_in_at = datetime('now') WHERE user_id = ?`).run(userId);
}

export function getUsersForSchool(db, schoolId) {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.school_id = ? ORDER BY u.role, u.full_name`).all(schoolId);
}

/** Which school a class or student belongs to, or null when it is unknown. */
export function schoolIdOf(db, { classGroupId, studentId } = {}) {
  if (classGroupId) {
    return db.prepare(`SELECT school_id AS schoolId FROM class_groups WHERE class_group_id = ?`).get(classGroupId)?.schoolId ?? null;
  }
  if (studentId) {
    return (
      db
        .prepare(`SELECT c.school_id AS schoolId FROM students st
                   JOIN class_groups c ON c.class_group_id = st.class_group_id WHERE st.student_id = ?`)
        .get(studentId)?.schoolId ?? null
    );
  }
  return null;
}

export function getSchool(db, schoolId) {
  return db.prepare(`SELECT ${SCHOOL_COLUMNS} FROM schools s WHERE s.school_id = ?`).get(schoolId) ?? null;
}

export function getAllSchools(db, { status } = {}) {
  return db
    .prepare(
      `SELECT ${SCHOOL_COLUMNS},
              (SELECT COUNT(*) FROM class_groups c WHERE c.school_id = s.school_id) AS classCount,
              (SELECT COUNT(*) FROM students st
                 JOIN class_groups c ON c.class_group_id = st.class_group_id
                WHERE c.school_id = s.school_id AND st.active = 1) AS studentCount
         FROM schools s
        WHERE @status IS NULL OR s.status = @status
        -- Waiting schools first, oldest first, so the queue reads top to bottom.
        ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END,
                 CASE s.status WHEN 'pending' THEN s.created_at END,
                 s.name`
    )
    .all({ status: status ?? null });
}

/** How many schools are in each status, for the system admin's filter tabs. */
export function countSchoolsByStatus(db) {
  const counts = Object.fromEntries(SCHOOL_STATUSES.map((s) => [s, 0]));
  for (const row of db.prepare(`SELECT status, COUNT(*) AS n FROM schools GROUP BY status`).all()) {
    counts[row.status] = row.n;
  }
  return counts;
}

// Which status changes a system admin may make, by current status.
const SCHOOL_TRANSITIONS = {
  pending: ['active', 'rejected'],
  active: ['inactive'],
  inactive: ['active'],
  rejected: [],
};

const TRANSITION_ACTIONS = {
  'pending>active': 'school.approved',
  'pending>rejected': 'school.rejected',
  'active>inactive': 'school.disabled',
  'inactive>active': 'school.enabled',
};

/**
 * Move a school to a new status. Returns null for an unknown school and throws
 * SchoolTransitionError for a change that is not allowed (e.g. enabling a
 * school that was never approved).
 */
export function changeSchoolStatus(db, schoolId, status, { actor = null, note = null } = {}) {
  if (!SCHOOL_STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  const school = getSchool(db, schoolId);
  if (!school) return null;
  if (!SCHOOL_TRANSITIONS[school.status].includes(status)) {
    throw new SchoolTransitionError(school.status, status);
  }

  db.prepare(
    `UPDATE schools
        SET status = @status, review_note = @note, reviewed_by = @actor, reviewed_at = datetime('now')
      WHERE school_id = @schoolId`
  ).run({ schoolId, status, note: note?.trim() || null, actor });
  logAudit(db, {
    action: TRANSITION_ACTIONS[`${school.status}>${status}`],
    actorId: actor,
    recordId: schoolId,
    detail: { from: school.status, to: status, note: note?.trim() || null },
  });
  return getSchool(db, schoolId);
}

export const approveSchool = (db, schoolId, opts) => changeSchoolStatus(db, schoolId, 'active', opts);
export const rejectSchool = (db, schoolId, opts) => changeSchoolStatus(db, schoolId, 'rejected', opts);

/** Kept for the original /status endpoint: enable or disable an approved school. */
export function setSchoolStatus(db, schoolId, status, opts) {
  if (status !== 'active' && status !== 'inactive') {
    throw new Error(`invalid status: ${status}`);
  }
  return changeSchoolStatus(db, schoolId, status, opts);
}

/**
 * The first school that is not active among those that own the given rows,
 * or null when every one is active (or unknown, which callers report on
 * their own). Pass any of schoolIds, classGroupIds or studentIds.
 */
export function findInactiveSchool(db, { schoolIds = [], classGroupIds = [], studentIds = [] } = {}) {
  const lookups = [
    [schoolIds, `SELECT school_id AS schoolId, name, status FROM schools WHERE school_id = ?`],
    [classGroupIds, `SELECT s.school_id AS schoolId, s.name, s.status FROM class_groups c
                       JOIN schools s ON s.school_id = c.school_id WHERE c.class_group_id = ?`],
    [studentIds, `SELECT s.school_id AS schoolId, s.name, s.status FROM students st
                    JOIN class_groups c ON c.class_group_id = st.class_group_id
                    JOIN schools s ON s.school_id = c.school_id WHERE st.student_id = ?`],
  ];
  for (const [ids, sql] of lookups) {
    const stmt = db.prepare(sql);
    const seen = new Set();
    for (const id of ids) {
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      const row = stmt.get(id);
      if (row && row.status !== 'active') return row;
    }
  }
  return null;
}

export function upsertClassGroup(db, { classGroupId, schoolId, grade, stream = null, academicYear, teacherName = null }) {
  db.prepare(
    `INSERT INTO class_groups (class_group_id, school_id, grade, stream, academic_year, teacher_name)
     VALUES (@classGroupId, @schoolId, @grade, @stream, @academicYear, @teacherName)
     ON CONFLICT(class_group_id) DO UPDATE SET
       school_id = excluded.school_id, grade = excluded.grade, stream = excluded.stream,
       academic_year = excluded.academic_year, teacher_name = excluded.teacher_name`
  ).run({ classGroupId, schoolId, grade: grade || 'Class', stream, academicYear: academicYear || new Date().getFullYear(), teacherName });
  return { classGroupId, schoolId, grade, stream, academicYear, teacherName };
}

export function patchClassGroup(db, classGroupId, patch = {}) {
  const fields = [];
  const params = { classGroupId };
  for (const [col, key] of [['grade', 'grade'], ['stream', 'stream'], ['academic_year', 'academicYear'], ['teacher_name', 'teacherName']]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = @${key}`);
      params[key] = patch[key];
    }
  }
  if (fields.length === 0) return;
  db.prepare(`UPDATE class_groups SET ${fields.join(', ')} WHERE class_group_id = @classGroupId`).run(params);
}

export function upsertStudent(db, { studentId, classGroupId, admissionNo = null, fullName, guardianPhone = null, guardianEmail = null, enrolledAt, active = true }) {
  db.prepare(
    `INSERT INTO students (student_id, class_group_id, admission_no, full_name, guardian_phone, guardian_email, enrolled_at, active)
     VALUES (@studentId, @classGroupId, @admissionNo, @fullName, @guardianPhone, @guardianEmail, @enrolledAt, @active)
     ON CONFLICT(student_id) DO UPDATE SET
       class_group_id = excluded.class_group_id, admission_no = excluded.admission_no,
       full_name = excluded.full_name, guardian_phone = excluded.guardian_phone,
       guardian_email = excluded.guardian_email, active = excluded.active`
  ).run({
    studentId, classGroupId, admissionNo: admissionNo || '', fullName, guardianPhone, guardianEmail,
    enrolledAt: enrolledAt || todayISO(), active: active ? 1 : 0,
  });
  return { studentId, classGroupId, admissionNo, fullName, guardianPhone, guardianEmail, enrolledAt, active };
}

export function patchStudent(db, studentId, patch = {}) {
  const fields = [];
  const params = { studentId };
  if (patch.fullName !== undefined) { fields.push('full_name = @fullName'); params.fullName = patch.fullName; }
  if (patch.admissionNo !== undefined) { fields.push('admission_no = @admissionNo'); params.admissionNo = patch.admissionNo || ''; }
  if (patch.guardianPhone !== undefined) { fields.push('guardian_phone = @guardianPhone'); params.guardianPhone = patch.guardianPhone || null; }
  if (patch.guardianEmail !== undefined) { fields.push('guardian_email = @guardianEmail'); params.guardianEmail = patch.guardianEmail || null; }
  if (patch.active !== undefined) { fields.push('active = @active'); params.active = patch.active ? 1 : 0; }
  if (fields.length === 0) return;
  db.prepare(`UPDATE students SET ${fields.join(', ')} WHERE student_id = @studentId`).run(params);
}

/** One active card per student, so any other active card is deactivated first. */
export function upsertCard(db, { cardUid, studentId }) {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE rfid_cards SET active = 0 WHERE student_id = ? AND active = 1 AND card_uid != ?`).run(studentId, cardUid);
    db.prepare(
      `INSERT INTO rfid_cards (card_uid, student_id, active) VALUES (?, ?, 1)
       ON CONFLICT(card_uid) DO UPDATE SET student_id = excluded.student_id, active = 1`
    ).run(cardUid, studentId);
  });
  tx();
  return { cardUid, studentId };
}

// Admin reporting across one school

export function getClassesForSchool(db, schoolId) {
  return db
    .prepare(
      `SELECT c.class_group_id AS classGroupId, c.grade, c.stream, c.academic_year AS academicYear,
              c.teacher_name AS teacherName,
              (SELECT COUNT(*) FROM students s WHERE s.class_group_id = c.class_group_id AND s.active = 1) AS studentCount
         FROM class_groups c
        WHERE c.school_id = ?
        ORDER BY c.grade, c.stream`
    )
    .all(schoolId);
}

export function getClassGroup(db, classGroupId) {
  return db
    .prepare(
      `SELECT class_group_id AS classGroupId, school_id AS schoolId, grade, stream,
              academic_year AS academicYear, teacher_name AS teacherName
         FROM class_groups WHERE class_group_id = ?`
    )
    .get(classGroupId);
}

export function getStudentsForClass(db, classGroupId, { includeInactive = false } = {}) {
  const clause = includeInactive ? '' : 'AND active = 1';
  return db
    .prepare(
      `SELECT student_id AS studentId, class_group_id AS classGroupId, admission_no AS admissionNo,
              full_name AS fullName, guardian_phone AS guardianPhone, guardian_email AS guardianEmail,
              enrolled_at AS enrolledAt, active
         FROM students WHERE class_group_id = ? ${clause} ORDER BY full_name`
    )
    .all(classGroupId);
}

function historyByStudent(db, studentIds, sinceISO) {
  const byStudent = new Map(studentIds.map((id) => [id, []]));
  if (studentIds.length === 0) return byStudent;
  const placeholders = studentIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT student_id, date, status FROM attendance_events WHERE student_id IN (${placeholders}) AND date >= ? ORDER BY date`)
    .all(...studentIds, sinceISO);
  for (const r of rows) byStudent.get(r.student_id)?.push({ date: r.date, status: r.status });
  return byStudent;
}

function daysAgoISO(n) {
  const dt = new Date();
  dt.setDate(dt.getDate() - n);
  return todayISO(dt);
}

/** Most recent follow-up per student. */
function latestFollowUpByStudent(db, studentIds) {
  const out = new Map();
  if (studentIds.length === 0) return out;
  const placeholders = studentIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT student_id, MAX(created_at) AS lastAt FROM follow_ups WHERE student_id IN (${placeholders}) GROUP BY student_id`
    )
    .all(...studentIds);
  for (const r of rows) out.set(r.student_id, r.lastAt);
  return out;
}

/**
 * Every assessable student in a school with an amber or red flag. `needsFollowUp`
 * is true when nobody has followed up in the last FOLLOW_UP_FRESH_DAYS.
 */
export function getFlaggedStudents(db, schoolId) {
  const students = db
    .prepare(
      `SELECT s.student_id AS studentId, s.full_name AS fullName, s.class_group_id AS classGroupId,
              s.guardian_phone AS guardianPhone, s.guardian_email AS guardianEmail,
              c.grade, c.stream, c.teacher_name AS teacherName
         FROM students s
         JOIN class_groups c ON c.class_group_id = s.class_group_id
        WHERE c.school_id = ? AND s.active = 1`
    )
    .all(schoolId);

  const ids = students.map((s) => s.studentId);
  const history = historyByStudent(db, ids, daysAgoISO(63));
  const lastFollowUp = latestFollowUpByStudent(db, ids);
  const freshCutoff = daysAgoISO(FOLLOW_UP_FRESH_DAYS);

  return students
    .map((s) => {
      const assessment = assessStudent(history.get(s.studentId) ?? []);
      if (!assessment || assessment.flag === 'green') return null;
      const lastAt = lastFollowUp.get(s.studentId) ?? null;
      const needsFollowUp = !lastAt || lastAt.slice(0, 10) < freshCutoff;
      return {
        studentId: s.studentId,
        fullName: s.fullName,
        classGroupId: s.classGroupId,
        className: [s.grade, s.stream].filter(Boolean).join(' '),
        teacherName: s.teacherName,
        guardianPhone: s.guardianPhone,
        guardianEmail: s.guardianEmail,
        flag: assessment.flag,
        dropoutProbability: assessment.dropoutProbability,
        patterns: assessment.patterns,
        lastFollowUpAt: lastAt,
        needsFollowUp,
      };
    })
    .filter(Boolean)
    .sort((a, b) => flagRank(b.flag) - flagRank(a.flag) || b.dropoutProbability - a.dropoutProbability);
}

export function getSchoolOverview(db, schoolId) {
  const date = todayISO();
  const classes = getClassesForSchool(db, schoolId);
  const studentCount = classes.reduce((sum, c) => sum + c.studentCount, 0);

  const todayCounts = db
    .prepare(
      `SELECT a.status, COUNT(*) AS n
         FROM attendance_events a
         JOIN students s ON s.student_id = a.student_id
         JOIN class_groups c ON c.class_group_id = s.class_group_id
        WHERE c.school_id = ? AND a.date = ?
        GROUP BY a.status`
    )
    .all(schoolId, date);
  const byStatus = Object.fromEntries(todayCounts.map((r) => [r.status, r.n]));
  const recordedToday = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const attendedToday = (byStatus.present ?? 0) + (byStatus.late ?? 0);

  const flagged = getFlaggedStudents(db, schoolId);

  return {
    schoolId,
    date,
    classCount: classes.length,
    studentCount,
    recordedToday,
    attendanceRateToday: recordedToday > 0 ? attendedToday / recordedToday : null,
    flaggedCount: flagged.length,
    needsFollowUpCount: flagged.filter((f) => f.needsFollowUp).length,
  };
}

// Follow-ups

export function addFollowUp(db, { studentId, flag, method, note = null, actor = null }) {
  const info = db
    .prepare(`INSERT INTO follow_ups (student_id, flag, method, note, actor) VALUES (?, ?, ?, ?, ?)`)
    .run(studentId, flag, method, note, actor);
  logAudit(db, { action: 'followup.logged', actorId: actor, recordId: studentId, detail: { flag, method } });
  return db.prepare(`SELECT * FROM follow_ups WHERE id = ?`).get(info.lastInsertRowid);
}

export function getFollowUps(db, studentId) {
  return db.prepare(`SELECT * FROM follow_ups WHERE student_id = ? ORDER BY created_at DESC`).all(studentId);
}
