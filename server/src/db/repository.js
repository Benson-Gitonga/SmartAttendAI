import { randomUUID } from 'node:crypto';
import { generateCode, hashCode, looksLikeCode, CODE_TTL_MS } from '../auth/setupCodes.js';
import { generateEmailToken, hashEmailToken, looksLikeEmailToken, EMAIL_TOKEN_TTL_MS } from '../auth/emailTokens.js';
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
            AND s.status NOT IN ('rejected', 'inactive')`
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
                 WHERE upper(s.school_code) = upper(trim(?)) AND s.status NOT IN ('rejected', 'inactive')`)
      .get(schoolCode) ?? null
  );
}

/**
 * A school's application: the school waits as 'pending' for a system admin.
 * The person applying gets an admin account with no password ('invited'):
 * they confirm their email first, and set a password from the link sent when
 * the school is approved. (A passwordHash, from older clients, makes the
 * account active at once.) Throws RegistrationConflictError when the email
 * already has an account, or the school is already registered.
 *
 * @param {object} school     name, county, subCounty, schoolCode, schoolType, boarding, studentEstimate
 * @param {object} applicant  fullName, email, phone, jobTitle, passwordHash?
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
      passwordHash: applicant.passwordHash ?? null,
      status: applicant.passwordHash ? 'active' : 'invited',
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

// A released email is still shown (and still gets a rejection email), but
// lookups by email only match u.email, so it is free for a new account.
const USER_COLUMNS = `u.user_id AS userId, coalesce(u.released_email, u.email) AS email, u.full_name AS fullName, u.phone,
  u.job_title AS jobTitle, u.role, u.school_id AS schoolId, u.status,
  u.created_at AS createdAt, u.last_sign_in_at AS lastSignInAt, u.email_verified_at AS emailVerifiedAt`;

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

/**
 * Free the emails of disabled accounts, so the same person can apply or be
 * invited again. The address moves to released_email and a placeholder that
 * no one can type takes its place. Accounts already released are left alone.
 */
function releaseEmails(db, where, ...params) {
  db.prepare(
    `UPDATE users SET released_email = email, email = 'released:' || user_id
      WHERE released_email IS NULL AND ${where}`
  ).run(...params);
}

/** Give an account its email back. Throws RegistrationConflictError('email') when someone has taken it since. */
function restoreEmail(db, userId) {
  const { released } = db.prepare(`SELECT released_email AS released FROM users WHERE user_id = ?`).get(userId);
  if (!released) return;
  if (findUserByEmail(db, released)) {
    throw new RegistrationConflictError('email', `${released} now belongs to another account`);
  }
  db.prepare(`UPDATE users SET email = released_email, released_email = NULL WHERE user_id = ?`).run(userId);
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
                WHERE c.school_id = s.school_id AND st.active = 1) AS studentCount,
              -- The applicant clicked the confirmation link (or set a password some other way).
              EXISTS (SELECT 1 FROM users u WHERE u.school_id = s.school_id AND u.role = 'admin'
                         AND (u.email_verified_at IS NOT NULL OR u.password_hash IS NOT NULL)) AS adminEmailVerified
         FROM schools s
        WHERE @status IS NULL OR s.status = @status
        -- Waiting schools first, oldest first, so the queue reads top to bottom.
        ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END,
                 CASE s.status WHEN 'pending' THEN s.created_at END,
                 s.name`
    )
    .all({ status: status ?? null })
    .map((s) => ({ ...s, adminEmailVerified: s.adminEmailVerified === 1 }));
}

/** True when the school's applicant has confirmed their email (or has a password already). */
export function isSchoolAdminVerified(db, schoolId) {
  return (
    db
      .prepare(`SELECT 1 FROM users WHERE school_id = ? AND role = 'admin'
                  AND (email_verified_at IS NOT NULL OR password_hash IS NOT NULL)`)
      .get(schoolId) != null
  );
}

/** The school's admin accounts, with whether each has a password yet. */
export function getSchoolAdmins(db, schoolId) {
  return db
    .prepare(`SELECT ${USER_COLUMNS}, (u.password_hash IS NOT NULL) AS hasPassword
                FROM users u WHERE u.school_id = ? AND u.role = 'admin' ORDER BY u.created_at`)
    .all(schoolId)
    .map((u) => ({ ...u, hasPassword: u.hasPassword === 1 }));
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

/** Re-enabling a school whose name, code or admin email has since been taken by a new application. */
export class SchoolReopenConflictError extends SchoolTransitionError {
  constructor(reason) {
    super('inactive', 'active');
    this.message = `this school cannot be enabled again: ${reason}`;
  }
}

/**
 * Move a school to a new status. Returns null for an unknown school and throws
 * SchoolTransitionError for a change that is not allowed (e.g. enabling a
 * school that was never approved).
 *
 * Rejecting or disabling a school frees its name, code and every account's
 * email, so the school can apply again. Enabling it takes them back: an
 * admin's email or the school's name or code taken in the meantime refuses the
 * change (SchoolReopenConflictError); a teacher whose email was taken stays
 * disabled.
 */
export function changeSchoolStatus(db, schoolId, status, { actor = null, note = null } = {}) {
  if (!SCHOOL_STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  const school = getSchool(db, schoolId);
  if (!school) return null;
  if (!SCHOOL_TRANSITIONS[school.status].includes(status)) {
    throw new SchoolTransitionError(school.status, status);
  }

  db.transaction(() => {
    if (school.status === 'inactive' && status === 'active') reopenSchool(db, school);
    db.prepare(
      `UPDATE schools
          SET status = @status, review_note = @note, reviewed_by = @actor, reviewed_at = datetime('now')
        WHERE school_id = @schoolId`
    ).run({ schoolId, status, note: note?.trim() || null, actor });
    // A teacher disabled on their own keeps status 'disabled', which is how
    // reopenSchool tells them apart from those freed with the school.
    if (status === 'inactive' || status === 'rejected') releaseEmails(db, 'school_id = ?', schoolId);
    logAudit(db, {
      action: TRANSITION_ACTIONS[`${school.status}>${status}`],
      actorId: actor,
      recordId: schoolId,
      detail: { from: school.status, to: status, note: note?.trim() || null },
    });
  })();
  return getSchool(db, schoolId);
}

function reopenSchool(db, school) {
  if (school.schoolCode && findSchoolByCode(db, school.schoolCode)) {
    throw new SchoolReopenConflictError(`another school has registered the code ${school.schoolCode}`);
  }
  if (findSchoolByName(db, school.name, school.county ?? null)) {
    throw new SchoolReopenConflictError(`another school called ${school.name} has registered in this county`);
  }
  const freed = db
    .prepare(`SELECT user_id AS userId, role FROM users
               WHERE school_id = ? AND released_email IS NOT NULL AND status <> 'disabled'`)
    .all(school.schoolId);
  for (const user of freed) {
    try {
      restoreEmail(db, user.userId);
    } catch (err) {
      if (!(err instanceof RegistrationConflictError)) throw err;
      if (user.role === 'admin') throw new SchoolReopenConflictError(err.message);
      db.prepare(`UPDATE users SET status = 'disabled' WHERE user_id = ?`).run(user.userId);
    }
  }
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
              coalesce(u.full_name, c.teacher_name) AS teacherName, c.teacher_user_id AS teacherUserId,
              (SELECT COUNT(*) FROM students s WHERE s.class_group_id = c.class_group_id AND s.active = 1) AS studentCount
         FROM class_groups c
         LEFT JOIN users u ON u.user_id = c.teacher_user_id
        WHERE c.school_id = ?
        ORDER BY c.grade, c.stream`
    )
    .all(schoolId);
}

export function getClassGroup(db, classGroupId) {
  return db
    .prepare(
      `SELECT c.class_group_id AS classGroupId, c.school_id AS schoolId, c.grade, c.stream,
              c.academic_year AS academicYear, coalesce(u.full_name, c.teacher_name) AS teacherName,
              c.teacher_user_id AS teacherUserId
         FROM class_groups c
         LEFT JOIN users u ON u.user_id = c.teacher_user_id
        WHERE c.class_group_id = ?`
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

// School admin: classes, teachers, the day's register board and corrections.

export const OVERRIDE_REASONS = ['teacher_absent', 'wrong_mark', 'late_arrival', 'gate_error', 'other'];
const ABSENCE_REASON_VALUES = ['fee', 'health', 'other', 'unknown'];

/** Teachers of a school, each with the classes they are assigned. */
export function getTeachersForSchool(db, schoolId) {
  const teachers = db
    .prepare(
      `SELECT user_id AS userId, coalesce(released_email, email) AS email, full_name AS fullName, phone, job_title AS jobTitle, status,
              last_sign_in_at AS lastSignInAt
         FROM users WHERE school_id = ? AND role = 'teacher' ORDER BY full_name`
    )
    .all(schoolId);
  const classes = db
    .prepare(
      `SELECT class_group_id AS classGroupId, grade, stream, teacher_user_id AS teacherUserId
         FROM class_groups WHERE school_id = ? AND teacher_user_id IS NOT NULL ORDER BY grade, stream`
    )
    .all(schoolId);
  const codes = openSetupCodes(db, teachers.map((t) => t.userId));
  return teachers.map((t) => ({
    ...t,
    classes: classes.filter((c) => c.teacherUserId === t.userId),
    openCode: codes.get(t.userId) ?? null,
  }));
}

/** A teacher account in this school that can be given a class, or null. */
function assignableTeacher(db, schoolId, userId) {
  return (
    db
      .prepare(`SELECT user_id AS userId, full_name AS fullName FROM users
                 WHERE user_id = ? AND school_id = ? AND role = 'teacher' AND status <> 'disabled'`)
      .get(userId, schoolId) ?? null
  );
}

export class ClassInputError extends Error {}

/** A school admin creates a class, optionally with its teacher. */
export function createClassGroup(db, { schoolId, grade, stream = null, academicYear, teacherUserId = null, actor = null }) {
  const teacher = teacherUserId ? assignableTeacher(db, schoolId, teacherUserId) : null;
  if (teacherUserId && !teacher) throw new ClassInputError('that teacher is not in this school');

  const classGroupId = `class-${randomUUID()}`;
  db.prepare(
    `INSERT INTO class_groups (class_group_id, school_id, grade, stream, academic_year, teacher_name, teacher_user_id)
     VALUES (@classGroupId, @schoolId, @grade, @stream, @academicYear, @teacherName, @teacherUserId)`
  ).run({
    classGroupId,
    schoolId,
    grade: grade.trim(),
    stream: stream?.trim() || null,
    academicYear,
    teacherName: teacher?.fullName ?? null,
    teacherUserId: teacher?.userId ?? null,
  });
  logAudit(db, { action: 'class.created', actorId: actor, recordId: classGroupId, detail: { grade, stream, teacherUserId } });
  return getClassGroup(db, classGroupId);
}

/** Rename a class or change its teacher (`teacherUserId: null` unassigns). */
export function updateClassGroup(db, classGroupId, patch, { actor = null } = {}) {
  const cls = getClassGroup(db, classGroupId);
  if (!cls) return null;
  const sets = [];
  const params = { classGroupId };
  if (patch.grade !== undefined) {
    sets.push('grade = @grade');
    params.grade = patch.grade.trim();
  }
  if (patch.stream !== undefined) {
    sets.push('stream = @stream');
    params.stream = patch.stream?.trim() || null;
  }
  if (patch.academicYear !== undefined) {
    sets.push('academic_year = @academicYear');
    params.academicYear = patch.academicYear;
  }
  if (patch.teacherUserId !== undefined) {
    const teacher = patch.teacherUserId ? assignableTeacher(db, cls.schoolId, patch.teacherUserId) : null;
    if (patch.teacherUserId && !teacher) throw new ClassInputError('that teacher is not in this school');
    sets.push('teacher_user_id = @teacherUserId', 'teacher_name = @teacherName');
    params.teacherUserId = teacher?.userId ?? null;
    params.teacherName = teacher?.fullName ?? null;
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE class_groups SET ${sets.join(', ')} WHERE class_group_id = @classGroupId`).run(params);
    logAudit(db, { action: 'class.updated', actorId: actor, recordId: classGroupId, detail: patch });
  }
  return getClassGroup(db, classGroupId);
}

/**
 * Every class's register for one day, for the admin's "Today" board.
 * status: 'empty' (no students), 'not_taken' (no marks at all), 'gate_only'
 * (only gate scans, no roll call yet), 'partial', or 'done'.
 */
export function getRegisterBoard(db, schoolId, date = todayISO()) {
  const rows = db
    .prepare(
      `SELECT c.class_group_id AS classGroupId, c.grade, c.stream,
              coalesce(u.full_name, c.teacher_name) AS teacherName, c.teacher_user_id AS teacherUserId,
              COUNT(DISTINCT s.student_id) AS studentCount,
              COUNT(a.event_id) AS marked,
              SUM(a.status = 'present') AS present,
              SUM(a.status = 'late') AS late,
              SUM(a.status = 'absent') AS absent,
              SUM(a.capture_method IN ('rfid', 'fingerprint')) AS gateMarks,
              SUM(a.capture_method = 'manual') AS manualMarks,
              MAX(a.created_at) AS lastMarkAt
         FROM class_groups c
         LEFT JOIN users u ON u.user_id = c.teacher_user_id
         LEFT JOIN students s ON s.class_group_id = c.class_group_id AND s.active = 1
         LEFT JOIN attendance_events a ON a.student_id = s.student_id AND a.date = @date
        WHERE c.school_id = @schoolId
        GROUP BY c.class_group_id
        ORDER BY c.grade, c.stream`
    )
    .all({ schoolId, date });

  const classes = rows.map((r) => {
    const n = (v) => v ?? 0;
    let status = 'done';
    if (r.studentCount === 0) status = 'empty';
    else if (r.marked === 0) status = 'not_taken';
    else if (n(r.manualMarks) === 0 && r.marked < r.studentCount) status = 'gate_only';
    else if (r.marked < r.studentCount) status = 'partial';
    return {
      ...r,
      present: n(r.present),
      late: n(r.late),
      absent: n(r.absent),
      gateMarks: n(r.gateMarks),
      manualMarks: n(r.manualMarks),
      unmarked: Math.max(0, r.studentCount - r.marked),
      lastMarkAt: r.lastMarkAt ? toIsoTimestamp(r.lastMarkAt) : null,
      status,
    };
  });

  const sum = (k) => classes.reduce((t, c) => t + c[k], 0);
  const marked = sum('marked');
  return {
    date,
    totals: {
      classes: classes.length,
      done: classes.filter((c) => c.status === 'done').length,
      waiting: classes.filter((c) => ['not_taken', 'gate_only', 'partial'].includes(c.status)).length,
      students: sum('studentCount'),
      present: sum('present'),
      late: sum('late'),
      absent: sum('absent'),
      unmarked: sum('unmarked'),
      attendanceRate: marked > 0 ? (sum('present') + sum('late')) / marked : null,
    },
    classes,
  };
}

/** One class's register for a day: every student, their mark (if any) and the last correction. */
export function getClassRegister(db, classGroupId, date = todayISO()) {
  const students = getStudentsForClass(db, classGroupId);
  const marks = new Map(getClassAttendanceForDate(db, classGroupId, date).map((m) => [m.studentId, m]));
  const overrides = new Map(
    db
      .prepare(
        `SELECT o.student_id AS studentId, o.from_status AS fromStatus, o.to_status AS toStatus, o.reason,
                o.note, o.actor, o.on_behalf_of AS onBehalfOf, o.created_at AS createdAt
           FROM attendance_overrides o
           JOIN students s ON s.student_id = o.student_id
          WHERE s.class_group_id = ? AND o.date = ?
          ORDER BY o.id`
      )
      .all(classGroupId, date)
      .map((o) => [o.studentId, { ...o, createdAt: toIsoTimestamp(o.createdAt) }])
  );
  return {
    date,
    students: students.map((st) => {
      const mark = marks.get(st.studentId);
      return {
        studentId: st.studentId,
        fullName: st.fullName,
        admissionNo: st.admissionNo,
        mark: mark
          ? {
              eventId: mark.eventId,
              status: mark.status,
              absenceReason: mark.reason,
              captureMethod: mark.captureMethod,
              recordedBy: mark.recordedBy,
              createdAt: mark.createdAt,
            }
          : null,
        override: overrides.get(st.studentId) ?? null,
      };
    }),
  };
}

/**
 * A school admin takes or corrects a class's register for a day. Each changed
 * mark updates attendance_events in place (or adds one), goes back on the
 * cloud sync queue, and leaves an attendance_overrides row with the reason.
 * Marks that already match are left alone.
 *
 * @param {{classGroupId, date, reason, note?, actor, marks: {studentId, status, absenceReason?}[]}} input
 * @returns {{changed: string[], unchanged: string[]}}
 */
export function overrideRegister(db, { classGroupId, date, reason, note = null, actor, marks }) {
  const cls = getClassGroup(db, classGroupId);
  const inClass = new Set(getStudentsForClass(db, classGroupId).map((st) => st.studentId));
  const findMark = db.prepare(`SELECT event_id AS eventId, status, reason FROM attendance_events WHERE student_id = ? AND date = ?`);
  const update = db.prepare(
    `UPDATE attendance_events
        SET status = @status, reason = @reason, capture_method = 'manual', source = 'manual',
            recorded_by = @actor, verified = 0, synced_at = NULL
      WHERE event_id = @eventId`
  );
  const insert = db.prepare(
    `INSERT INTO attendance_events (event_id, student_id, date, status, capture_method, recorded_by, reason, source, created_at)
     VALUES (@eventId, @studentId, @date, @status, 'manual', @actor, @reason, 'manual', @createdAt)`
  );
  const enqueue = db.prepare(
    `INSERT INTO sync_queue (event_id, payload, status) VALUES (@eventId, @payload, 'pending')
     ON CONFLICT (event_id) DO UPDATE SET payload = excluded.payload, status = 'pending', attempt_count = 0,
       next_attempt_at = NULL, last_error = NULL, synced_at = NULL`
  );
  const logOverride = db.prepare(
    `INSERT INTO attendance_overrides
       (event_id, student_id, date, from_status, to_status, from_reason, to_reason, reason, note, actor, on_behalf_of)
     VALUES (@eventId, @studentId, @date, @fromStatus, @toStatus, @fromReason, @toReason, @reason, @note, @actor, @onBehalfOf)`
  );

  const changed = [];
  const unchanged = [];
  db.transaction(() => {
    for (const m of marks) {
      if (!inClass.has(m.studentId)) throw new ClassInputError(`${m.studentId} is not in this class`);
      const absenceReason = m.status === 'absent' && ABSENCE_REASON_VALUES.includes(m.absenceReason) ? m.absenceReason : null;
      const existing = findMark.get(m.studentId, date);
      if (existing && existing.status === m.status && (existing.reason ?? null) === absenceReason) {
        unchanged.push(m.studentId);
        continue;
      }

      const createdIso = new Date().toISOString();
      const eventId = existing?.eventId ?? randomUUID();
      if (existing) {
        update.run({ eventId, status: m.status, reason: absenceReason, actor });
      } else {
        insert.run({
          eventId, studentId: m.studentId, date, status: m.status, reason: absenceReason, actor,
          createdAt: toSqliteTimestamp(createdIso),
        });
      }

      enqueue.run({
        eventId,
        payload: JSON.stringify({
          eventId, studentId: m.studentId, date, status: m.status, captureMethod: 'manual',
          recordedBy: actor, reason: absenceReason, createdAt: createdIso,
        }),
      });
      logOverride.run({
        eventId,
        studentId: m.studentId,
        date,
        fromStatus: existing?.status ?? null,
        toStatus: m.status,
        fromReason: existing?.reason ?? null,
        toReason: absenceReason,
        reason,
        note: note?.trim() || null,
        actor,
        onBehalfOf: cls?.teacherName ?? null,
      });
      changed.push(m.studentId);
    }
    if (changed.length > 0) {
      logAudit(db, {
        action: 'attendance.overridden',
        actorId: actor,
        recordId: classGroupId,
        detail: { date, reason, note: note?.trim() || null, students: changed },
      });
    }
  })();
  return { changed, unchanged };
}

/** The classes a teacher is assigned, with their students, for the teacher's device to download. */
export function getTeacherClasses(db, userId) {
  const classes = db
    .prepare(
      `SELECT c.class_group_id AS classGroupId, c.school_id AS schoolId, c.grade, c.stream,
              c.academic_year AS academicYear, coalesce(u.full_name, c.teacher_name) AS teacherName
         FROM class_groups c
         LEFT JOIN users u ON u.user_id = c.teacher_user_id
        WHERE c.teacher_user_id = ?
        ORDER BY c.grade, c.stream`
    )
    .all(userId);
  const cards = db.prepare(`SELECT card_uid AS cardUid FROM rfid_cards WHERE student_id = ? AND active = 1`);
  return classes.map((c) => ({
    ...c,
    students: getStudentsForClass(db, c.classGroupId).map((st) => ({
      ...st,
      active: st.active === 1,
      cardUid: cards.get(st.studentId)?.cardUid ?? null,
    })),
  }));
}

/**
 * A class's attendance from `sinceISO` on, for a teacher's device to keep
 * offline (the at-risk list and reports are worked out on the phone).
 */
export function getClassAttendanceSince(db, classGroupId, sinceISO) {
  return db
    .prepare(
      `SELECT a.event_id AS eventId, a.student_id AS studentId, a.date, a.status, a.reason,
              a.capture_method AS captureMethod, a.recorded_by AS recordedBy, a.created_at AS createdAt
         FROM attendance_events a
         JOIN students s ON s.student_id = a.student_id
        WHERE s.class_group_id = ? AND a.date >= ?
        ORDER BY a.date, a.student_id`
    )
    .all(classGroupId, sinceISO);
}

// Teacher invites and password resets (one-time codes, see auth/setupCodes.js).

/**
 * Make a new one-time code for a user, revoking any they had. Returns the
 * plain code; it is not stored and cannot be shown again.
 */
export function issueSetupCode(db, { userId, purpose, createdBy = null, ttlMs = CODE_TTL_MS, now = Date.now() }) {
  const code = generateCode();
  const expiresAt = new Date(now + ttlMs).toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE setup_codes SET revoked_at = datetime('now') WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL`
    ).run(userId);
    db.prepare(
      `INSERT INTO setup_codes (user_id, code_hash, purpose, created_by, expires_at) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, hashCode(code), purpose, createdBy, expiresAt);
    logAudit(db, { action: `user.${purpose}_code_issued`, actorId: createdBy, recordId: userId, detail: { expiresAt } });
  })();
  return { code, expiresAt, purpose };
}

/**
 * What a code is for, for the "you're joining ..." page. `state` is 'ok',
 * 'used', 'revoked', 'expired', or 'unknown' (no such code).
 */
export function lookupSetupCode(db, code, now = Date.now()) {
  if (!looksLikeCode(code)) return { state: 'unknown' };
  const row = db
    .prepare(
      `SELECT sc.id, sc.purpose, sc.expires_at AS expiresAt, sc.used_at AS usedAt, sc.revoked_at AS revokedAt,
              u.user_id AS userId, coalesce(u.released_email, u.email) AS email, u.full_name AS fullName, u.role, u.status AS userStatus,
              s.school_id AS schoolId, s.name AS schoolName
         FROM setup_codes sc
         JOIN users u ON u.user_id = sc.user_id
         JOIN schools s ON s.school_id = u.school_id
        WHERE sc.code_hash = ?`
    )
    .get(hashCode(code));
  if (!row) return { state: 'unknown' };
  let state = 'ok';
  if (row.usedAt) state = 'used';
  else if (row.revokedAt) state = 'revoked';
  else if (Date.parse(row.expiresAt) <= now) state = 'expired';
  else if (row.userStatus === 'disabled') state = 'revoked';
  return { state, ...row };
}

/** Set the password from a good code; the code is used up. Returns the user, or null. */
export function redeemSetupCode(db, code, passwordHash, now = Date.now()) {
  const found = lookupSetupCode(db, code, now);
  if (found.state !== 'ok') return null;
  db.transaction(() => {
    db.prepare(`UPDATE setup_codes SET used_at = datetime('now') WHERE id = ?`).run(found.id);
    db.prepare(`UPDATE users SET password_hash = ?, status = 'active' WHERE user_id = ?`).run(passwordHash, found.userId);
    logAudit(db, { action: `user.${found.purpose}_code_used`, actorId: found.email, recordId: found.userId });
  })();
  return getUser(db, found.userId);
}

/**
 * A school admin adds a teacher, who gets an invite code to set their own
 * password. Throws RegistrationConflictError('email') when the email is taken.
 */
export function inviteTeacher(db, { schoolId, fullName, email, phone = null, createdBy = null }) {
  return db.transaction(() => {
    if (findUserByEmail(db, email)) {
      throw new RegistrationConflictError('email', 'an account with this email already exists');
    }
    const teacher = createUser(db, { email, fullName, phone, role: 'teacher', schoolId, status: 'invited' });
    const invite = issueSetupCode(db, { userId: teacher.userId, purpose: 'invite', createdBy });
    return { teacher, ...invite };
  })();
}

/** A teacher in this school (any status), or null. */
export function getSchoolTeacher(db, schoolId, userId) {
  const user = getUser(db, userId);
  return user && user.schoolId === schoolId && user.role === 'teacher' ? user : null;
}

/**
 * Disable or re-enable a teacher. Disabling also revokes any open code and
 * frees their email; enabling takes it back, or throws
 * RegistrationConflictError('email') when another account has it now.
 */
export function setTeacherEnabled(db, userId, enabled, { actor = null } = {}) {
  const user = getUser(db, userId);
  if (!user) return null;
  const hasPassword = db.prepare(`SELECT password_hash IS NOT NULL AS has FROM users WHERE user_id = ?`).get(userId).has === 1;
  const status = enabled ? (hasPassword ? 'active' : 'invited') : 'disabled';
  db.transaction(() => {
    if (enabled) restoreEmail(db, userId);
    db.prepare(`UPDATE users SET status = ? WHERE user_id = ?`).run(status, userId);
    if (!enabled) {
      db.prepare(`UPDATE setup_codes SET revoked_at = datetime('now') WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL`).run(userId);
      releaseEmails(db, 'user_id = ?', userId);
    }
    logAudit(db, { action: enabled ? 'user.enabled' : 'user.disabled', actorId: actor, recordId: userId });
  })();
  return getUser(db, userId);
}

/** The newest code still waiting to be used, per user, for the Teachers page. */
export function openSetupCodes(db, userIds, now = Date.now()) {
  const open = new Map();
  if (userIds.length === 0) return open;
  const rows = db
    .prepare(
      `SELECT user_id AS userId, purpose, expires_at AS expiresAt, created_at AS createdAt
         FROM setup_codes
        WHERE used_at IS NULL AND revoked_at IS NULL AND user_id IN (${userIds.map(() => '?').join(',')})
        ORDER BY id`
    )
    .all(...userIds);
  for (const r of rows) {
    if (Date.parse(r.expiresAt) > now) open.set(r.userId, { purpose: r.purpose, expiresAt: r.expiresAt });
    else open.set(r.userId, { purpose: r.purpose, expiresAt: r.expiresAt, expired: true });
  }
  return open;
}

// Links sent by email (see auth/emailTokens.js).

/**
 * A new link for a user, revoking any open link of the same purpose. Returns
 * the plain token; it is not stored and cannot be shown again.
 * @param {'verify_email'|'setup'|'reset'} purpose
 */
export function issueEmailToken(db, { userId, purpose, ttlMs = EMAIL_TOKEN_TTL_MS[purpose], now = Date.now() }) {
  const token = generateEmailToken();
  const expiresAt = new Date(now + ttlMs).toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE email_tokens SET revoked_at = datetime('now')
        WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL`
    ).run(userId, purpose);
    db.prepare(`INSERT INTO email_tokens (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?)`)
      .run(userId, hashEmailToken(token), purpose, expiresAt);
    logAudit(db, { action: `user.${purpose}_link_issued`, recordId: userId, detail: { expiresAt } });
  })();
  return { token, expiresAt };
}

/**
 * What a link is for. `state` is 'ok', 'used', 'revoked', 'expired' or
 * 'unknown'. A disabled account's links count as revoked.
 */
export function lookupEmailToken(db, token, now = Date.now()) {
  if (!looksLikeEmailToken(token)) return { state: 'unknown' };
  const row = db
    .prepare(
      `SELECT t.id, t.purpose, t.expires_at AS expiresAt, t.used_at AS usedAt, t.revoked_at AS revokedAt,
              u.user_id AS userId, coalesce(u.released_email, u.email) AS email, u.full_name AS fullName, u.role, u.status AS userStatus,
              (u.password_hash IS NOT NULL) AS hasPassword,
              s.school_id AS schoolId, s.name AS schoolName, s.status AS schoolStatus
         FROM email_tokens t
         JOIN users u ON u.user_id = t.user_id
         JOIN schools s ON s.school_id = u.school_id
        WHERE t.token_hash = ?`
    )
    .get(hashEmailToken(token));
  if (!row) return { state: 'unknown' };
  let state = 'ok';
  if (row.usedAt) state = 'used';
  else if (row.revokedAt) state = 'revoked';
  else if (Date.parse(row.expiresAt) <= now) state = 'expired';
  else if (row.userStatus === 'disabled') state = 'revoked';
  return { state, ...row, hasPassword: row.hasPassword === 1 };
}

/** Confirm the email address from a 'verify_email' link. Returns the user, or null. */
export function confirmEmailWithToken(db, token, now = Date.now()) {
  const found = lookupEmailToken(db, token, now);
  if (found.state !== 'ok' || found.purpose !== 'verify_email') return null;
  db.transaction(() => {
    db.prepare(`UPDATE email_tokens SET used_at = datetime('now') WHERE id = ?`).run(found.id);
    db.prepare(`UPDATE users SET email_verified_at = coalesce(email_verified_at, datetime('now')) WHERE user_id = ?`).run(found.userId);
    logAudit(db, { action: 'user.email_verified', actorId: found.email, recordId: found.userId });
  })();
  return getUser(db, found.userId);
}

/**
 * Set a password from a 'setup' or 'reset' link: the link is used up, the
 * account becomes active and its email counts as confirmed (the link reached
 * it). Any other open set-up or reset link for the account stops working.
 * Returns the user, or null.
 */
export function setPasswordWithToken(db, token, passwordHash, now = Date.now()) {
  const found = lookupEmailToken(db, token, now);
  if (found.state !== 'ok' || (found.purpose !== 'setup' && found.purpose !== 'reset')) return null;
  db.transaction(() => {
    db.prepare(`UPDATE email_tokens SET used_at = datetime('now') WHERE id = ?`).run(found.id);
    db.prepare(
      `UPDATE email_tokens SET revoked_at = datetime('now')
        WHERE user_id = ? AND purpose IN ('setup', 'reset') AND used_at IS NULL AND revoked_at IS NULL`
    ).run(found.userId);
    // The one-time codes an admin handed out are replaced by this password too.
    db.prepare(`UPDATE setup_codes SET revoked_at = datetime('now') WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL`)
      .run(found.userId);
    db.prepare(
      `UPDATE users SET password_hash = ?, status = 'active',
              email_verified_at = coalesce(email_verified_at, datetime('now'))
        WHERE user_id = ?`
    ).run(passwordHash, found.userId);
    logAudit(db, { action: `user.${found.purpose}_link_used`, actorId: found.email, recordId: found.userId });
  })();
  return getUser(db, found.userId);
}

/** The user for an email with whether they have a password, for "forgot password". */
export function findUserForReset(db, email) {
  const row = db
    .prepare(
      `SELECT ${USER_COLUMNS}, (u.password_hash IS NOT NULL) AS hasPassword, s.status AS schoolStatus, s.name AS schoolName
         FROM users u JOIN schools s ON s.school_id = u.school_id
        WHERE u.email = trim(?)`
    )
    .get(String(email ?? ''));
  return row ? { ...row, hasPassword: row.hasPassword === 1 } : null;
}

// Students, managed by the school admin only. Each student gets a card number
// on enrolment; it is printed as a barcode/QR on their ID card and also works
// on the RFID gate.

export class StudentInputError extends Error {}

const STUDENT_COLUMNS = `st.student_id AS studentId, st.class_group_id AS classGroupId, st.admission_no AS admissionNo,
  st.full_name AS fullName, st.guardian_phone AS guardianPhone, st.guardian_email AS guardianEmail,
  st.enrolled_at AS enrolledAt, st.active,
  c.grade, c.stream,
  (SELECT r.card_uid FROM rfid_cards r WHERE r.student_id = st.student_id AND r.active = 1) AS cardUid`;

const toStudent = (row) => row && {
  ...row,
  active: row.active === 1,
  className: [row.grade, row.stream].filter(Boolean).join(' '),
};

/** A new card number: 8 hex characters, unique across every card ever issued. */
export function generateCardUid(db) {
  const taken = db.prepare(`SELECT 1 FROM rfid_cards WHERE card_uid = ?`);
  for (let i = 0; i < 20; i += 1) {
    const uid = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    if (!taken.get(uid)) return uid;
  }
  throw new Error('could not find a free card number');
}

export function getSchoolStudent(db, schoolId, studentId) {
  return toStudent(
    db
      .prepare(`SELECT ${STUDENT_COLUMNS} FROM students st JOIN class_groups c ON c.class_group_id = st.class_group_id
                 WHERE st.student_id = ? AND c.school_id = ?`)
      .get(studentId, schoolId)
  ) ?? null;
}

/** Every student in a school, or one class, by class then name. */
export function getSchoolStudents(db, schoolId, { classGroupId = null, includeInactive = false } = {}) {
  return db
    .prepare(
      `SELECT ${STUDENT_COLUMNS}
         FROM students st JOIN class_groups c ON c.class_group_id = st.class_group_id
        WHERE c.school_id = @schoolId
          AND (@classGroupId IS NULL OR st.class_group_id = @classGroupId)
          AND (@includeInactive = 1 OR st.active = 1)
        ORDER BY c.grade, c.stream, st.full_name`
    )
    .all({ schoolId, classGroupId, includeInactive: includeInactive ? 1 : 0 })
    .map(toStudent);
}

/** Another active student in the school already using this admission number. */
function admissionTaken(db, schoolId, admissionNo, exceptStudentId = null) {
  if (!admissionNo) return false;
  return (
    db
      .prepare(
        `SELECT 1 FROM students st JOIN class_groups c ON c.class_group_id = st.class_group_id
          WHERE c.school_id = ? AND upper(trim(st.admission_no)) = upper(trim(?)) AND st.active = 1
            AND st.student_id <> coalesce(?, '')`
      )
      .get(schoolId, admissionNo, exceptStudentId) != null
  );
}

const cleanText = (v) => (typeof v === 'string' ? v.trim() : v) || null;

/**
 * Enrol one student in a class of `schoolId`, with a new card. Throws
 * StudentInputError for a class outside the school or a duplicate admission no.
 */
export function enrolStudent(db, schoolId, { classGroupId, fullName, admissionNo = null, guardianPhone = null, guardianEmail = null }, { actor = null } = {}) {
  const cls = getClassGroup(db, classGroupId);
  if (!cls || cls.schoolId !== schoolId) throw new StudentInputError('that class is not in this school');
  const adm = cleanText(admissionNo);
  if (admissionTaken(db, schoolId, adm)) throw new StudentInputError(`admission number ${adm} is already used by another student`);

  const studentId = `stu-${randomUUID()}`;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO students (student_id, class_group_id, admission_no, full_name, guardian_phone, guardian_email, enrolled_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(studentId, classGroupId, adm ?? '', fullName.trim(), cleanText(guardianPhone), cleanText(guardianEmail), todayISO());
    db.prepare(`INSERT INTO rfid_cards (card_uid, student_id, active) VALUES (?, ?, 1)`).run(generateCardUid(db), studentId);
    logAudit(db, { action: 'student.enrolled', actorId: actor, recordId: studentId, detail: { classGroupId, admissionNo: adm } });
  })();
  return getSchoolStudent(db, schoolId, studentId);
}

/**
 * Enrol many students into one class at once (a CSV import). All or nothing:
 * any bad row stops the import and nothing is saved, so the admin fixes the
 * file and tries again. Returns the new students.
 * @throws {StudentInputError} with `.row` (1-based) for the first bad row
 */
export function importStudents(db, schoolId, classGroupId, rows, { actor = null } = {}) {
  const seen = new Set();
  rows.forEach((r, i) => {
    const adm = cleanText(r.admissionNo)?.toUpperCase();
    if (!adm) return;
    if (seen.has(adm)) throw Object.assign(new StudentInputError(`row ${i + 1}: admission number ${adm} appears twice in the file`), { row: i + 1 });
    seen.add(adm);
  });
  return db.transaction(() => rows.map((r, i) => {
    try {
      return enrolStudent(db, schoolId, { ...r, classGroupId }, { actor });
    } catch (err) {
      if (err instanceof StudentInputError) throw Object.assign(new StudentInputError(`row ${i + 1}: ${err.message}`), { row: i + 1 });
      throw err;
    }
  }))();
}

/**
 * Edit a student: details, move to another class of the school, or remove
 * (`active: false`, kept with their history) and restore.
 */
export function updateSchoolStudent(db, schoolId, studentId, patch, { actor = null } = {}) {
  const student = getSchoolStudent(db, schoolId, studentId);
  if (!student) return null;
  const sets = [];
  const params = { studentId };
  if (patch.fullName !== undefined) { sets.push('full_name = @fullName'); params.fullName = patch.fullName.trim(); }
  if (patch.admissionNo !== undefined) {
    const adm = cleanText(patch.admissionNo);
    if (admissionTaken(db, schoolId, adm, studentId)) throw new StudentInputError(`admission number ${adm} is already used by another student`);
    sets.push('admission_no = @admissionNo');
    params.admissionNo = adm ?? '';
  }
  if (patch.guardianPhone !== undefined) { sets.push('guardian_phone = @guardianPhone'); params.guardianPhone = cleanText(patch.guardianPhone); }
  if (patch.guardianEmail !== undefined) { sets.push('guardian_email = @guardianEmail'); params.guardianEmail = cleanText(patch.guardianEmail); }
  if (patch.classGroupId !== undefined && patch.classGroupId !== student.classGroupId) {
    const cls = getClassGroup(db, patch.classGroupId);
    if (!cls || cls.schoolId !== schoolId) throw new StudentInputError('that class is not in this school');
    sets.push('class_group_id = @classGroupId');
    params.classGroupId = patch.classGroupId;
  }
  if (patch.active !== undefined) {
    if (patch.active && !student.active && admissionTaken(db, schoolId, student.admissionNo, studentId)) {
      throw new StudentInputError(`admission number ${student.admissionNo} is now used by another student`);
    }
    sets.push('active = @active');
    params.active = patch.active ? 1 : 0;
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE students SET ${sets.join(', ')} WHERE student_id = @studentId`).run(params);
    const action = patch.active === false ? 'student.removed' : patch.active === true ? 'student.restored'
      : patch.classGroupId && patch.classGroupId !== student.classGroupId ? 'student.moved' : 'student.updated';
    logAudit(db, { action, actorId: actor, recordId: studentId, detail: patch });
  }
  return getSchoolStudent(db, schoolId, studentId);
}

/** A replacement card (lost or damaged): the old number stops working. */
export function reissueStudentCard(db, schoolId, studentId, { actor = null } = {}) {
  const student = getSchoolStudent(db, schoolId, studentId);
  if (!student) return null;
  const uid = generateCardUid(db);
  db.transaction(() => {
    db.prepare(`UPDATE rfid_cards SET active = 0 WHERE student_id = ? AND active = 1`).run(studentId);
    db.prepare(`INSERT INTO rfid_cards (card_uid, student_id, active) VALUES (?, ?, 1)`).run(uid, studentId);
    logAudit(db, { action: 'student.card_reissued', actorId: actor, recordId: studentId, detail: { from: student.cardUid, to: uid } });
  })();
  return getSchoolStudent(db, schoolId, studentId);
}

/**
 * A card scanned at a school's scan station (USB barcode scanner or camera).
 * Marks the student present for today unless they already have a mark.
 * @returns {{outcome: 'recorded'|'duplicate'|'unknown-card', student?: object, mark?: object}}
 */
export function recordStationScan(db, schoolId, cardUid, { actor = null } = {}) {
  const uid = String(cardUid ?? '').trim().toUpperCase();
  const found = findStudentByCardUid(db, uid);
  const student = found ? getSchoolStudent(db, schoolId, found.student_id) : null;
  if (!student || !student.active) {
    logAudit(db, { action: 'scan.unknown_card', actorId: actor, recordId: uid, detail: { schoolId } });
    return { outcome: 'unknown-card', cardUid: uid };
  }
  const date = todayISO();
  const existing = db
    .prepare(`SELECT event_id AS eventId, status, capture_method AS captureMethod, created_at AS createdAt
                FROM attendance_events WHERE student_id = ? AND date = ?`)
    .get(student.studentId, date);
  if (existing) return { outcome: 'duplicate', student, mark: { ...existing, createdAt: toIsoTimestamp(existing.createdAt) } };
  const mark = recordAttendance(db, {
    studentId: student.studentId, date, status: 'present', captureMethod: 'rfid', recordedBy: actor, source: 'client',
  });
  return { outcome: 'recorded', student, mark };
}
