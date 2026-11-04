import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { todayISO } from '../db/repository.js';
import { testUserAuth, staffHeaders } from '../auth/testing.js';
import { createMailer } from '../mail/mailer.js';

let db;
let server;
let base;
let admin;
let otherAdmin;
let mailer;

const send = (method, path, headers, body) =>
  fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const enrol = (body, classId = 'class-1') => send('POST', `/api/admin/classes/${classId}/students`, admin, body);

beforeEach(async () => {
  db = openDatabase(':memory:');
  const userAuth = testUserAuth(db);
  mailer = createMailer({ quiet: true });
  server = createApp({ db, logger: false, userAuth, mailer }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.prepare(`INSERT INTO schools (school_id, name) VALUES ('school-1', 'Kibera Secondary'), ('school-2', 'Other School')`).run();
  db.prepare(`INSERT INTO class_groups (class_group_id, school_id, grade, stream, academic_year) VALUES
              ('class-1', 'school-1', 'Form 1', 'East', 2026), ('class-2', 'school-1', 'Form 2', NULL, 2026),
              ('class-x', 'school-2', 'Form 1', NULL, 2026)`).run();
  admin = staffHeaders(db, userAuth, { schoolId: 'school-1', role: 'admin', email: 'admin@kibera.ac.ke' });
  otherAdmin = staffHeaders(db, userAuth, { schoolId: 'school-2', role: 'admin', email: 'admin@other.ac.ke' });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('enrolling students', () => {
  test('a new student gets a card number straight away', async () => {
    const res = await enrol({ fullName: 'Amina Hassan', admissionNo: 'KB/001', guardianPhone: '0712345678' });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.match(body.studentId, /^stu-/);
    assert.match(body.cardUid, /^[0-9A-F]{8}$/);
    assert.equal(body.className, 'Form 1 East');
    assert.equal(body.active, true);
  });

  test('admission numbers are unique within the school (any case)', async () => {
    await enrol({ fullName: 'Amina Hassan', admissionNo: 'KB/001' });
    const res = await enrol({ fullName: 'Brian Otieno', admissionNo: 'kb/001' }, 'class-2');
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /already used/);
  });

  test("another school's class is a 404", async () => {
    assert.equal((await enrol({ fullName: 'Amina' }, 'class-x')).status, 404);
  });

  test('400 for a bad guardian phone', async () => {
    assert.equal((await enrol({ fullName: 'Amina', guardianPhone: '123' })).status, 400);
  });

  test('a teacher cannot enrol students', async () => {
    const userAuth = testUserAuth(db);
    const teacher = staffHeaders(db, userAuth, { schoolId: 'school-1', role: 'teacher' });
    assert.equal((await send('POST', '/api/admin/classes/class-1/students', teacher, { fullName: 'Amina' })).status, 403);
  });
});

describe('importing a class list', () => {
  test('enrols every row, each with a card', async () => {
    const res = await send('POST', '/api/admin/classes/class-1/students/import', admin, {
      students: [{ fullName: 'Amina Hassan', admissionNo: '1' }, { fullName: 'Brian Otieno', admissionNo: '2' }, { fullName: 'Chebet Koech' }],
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.students.length, 3);
    assert.equal(new Set(body.students.map((s) => s.cardUid)).size, 3);
  });

  test('one bad row saves nothing and says which row', async () => {
    await enrol({ fullName: 'Existing', admissionNo: '2' });
    const res = await send('POST', '/api/admin/classes/class-1/students/import', admin, {
      students: [{ fullName: 'Amina Hassan', admissionNo: '1' }, { fullName: 'Brian Otieno', admissionNo: '2' }],
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.row, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM students').get().n, 1);
  });

  test('the same admission number twice in the file', async () => {
    const res = await send('POST', '/api/admin/classes/class-1/students/import', admin, {
      students: [{ fullName: 'Ann Wanjiru', admissionNo: '7' }, { fullName: 'Ben Kamau', admissionNo: '7' }],
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /appears twice/);
  });
});

describe('editing, moving and removing', () => {
  let student;
  beforeEach(async () => {
    student = await (await enrol({ fullName: 'Amina Hassan', admissionNo: 'KB/001' })).json();
  });

  test('moves a student to another class of the school', async () => {
    const res = await send('PATCH', `/api/admin/students/${student.studentId}`, admin, { classGroupId: 'class-2' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).className, 'Form 2');
    assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'student.moved'`).get());
  });

  test("cannot move a student into another school's class", async () => {
    const res = await send('PATCH', `/api/admin/students/${student.studentId}`, admin, { classGroupId: 'class-x' });
    assert.equal(res.status, 400);
  });

  test('removing keeps the student (and history), restoring brings them back', async () => {
    await send('PATCH', `/api/admin/students/${student.studentId}`, admin, { active: false });
    const list = async (q = '') => (await (await send('GET', `/api/admin/schools/school-1/students${q}`, admin)).json()).students;
    assert.equal((await list()).length, 0);
    assert.equal((await list('?inactive=1')).length, 1);
    await send('PATCH', `/api/admin/students/${student.studentId}`, admin, { active: true });
    assert.equal((await list()).length, 1);
  });

  test('a new card replaces the old number', async () => {
    const res = await send('POST', `/api/admin/students/${student.studentId}/card`, admin);
    const updated = await res.json();
    assert.notEqual(updated.cardUid, student.cardUid);
    const scanOld = await send('POST', '/api/gate/scan', admin, { cardUid: student.cardUid });
    assert.equal(scanOld.status, 404);
  });

  test("another school's admin cannot see or touch the student", async () => {
    assert.equal((await send('PATCH', `/api/admin/students/${student.studentId}`, otherAdmin, { fullName: 'x' })).status, 404);
    assert.equal((await send('GET', '/api/admin/schools/school-1/students', otherAdmin)).status, 404);
  });
});

describe('the scan station', () => {
  test('a scan marks the student present for today, once', async () => {
    const student = await (await enrol({ fullName: 'Amina Hassan' })).json();
    const first = await send('POST', '/api/gate/scan', admin, { cardUid: student.cardUid.toLowerCase() });
    const body = await first.json();
    assert.equal(first.status, 200);
    assert.equal(body.outcome, 'recorded');
    assert.equal(body.student.fullName, 'Amina Hassan');

    const row = db.prepare('SELECT * FROM attendance_events').get();
    assert.deepEqual([row.date, row.status, row.capture_method], [todayISO(), 'present', 'rfid']);

    const again = await (await send('POST', '/api/gate/scan', admin, { cardUid: student.cardUid })).json();
    assert.equal(again.outcome, 'duplicate');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_events').get().n, 1);
  });

  test("another school's card is unknown here", async () => {
    const student = await (await enrol({ fullName: 'Amina Hassan' })).json();
    const res = await send('POST', '/api/gate/scan', otherAdmin, { cardUid: student.cardUid });
    assert.equal(res.status, 404);
  });

  test('a teacher on gate duty can run the station', async () => {
    const student = await (await enrol({ fullName: 'Amina Hassan' })).json();
    const teacher = staffHeaders(db, testUserAuth(db), { schoolId: 'school-1', role: 'teacher', email: 'gate@kibera.ac.ke' });
    const res = await send('POST', '/api/gate/scan', teacher, { cardUid: student.cardUid });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).outcome, 'recorded');
    assert.equal(db.prepare('SELECT recorded_by FROM attendance_events').get().recorded_by, 'gate@kibera.ac.ke');
  });

  test('a scan saved offline and sent later lands on the day it happened', async () => {
    const student = await (await enrol({ fullName: 'Amina Hassan' })).json();
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    yesterday.setHours(7, 15, 0, 0);
    const body = { cardUid: student.cardUid, scannedAt: yesterday.toISOString() };

    assert.equal((await (await send('POST', '/api/gate/scan', admin, body)).json()).outcome, 'recorded');
    const row = db.prepare('SELECT date, created_at FROM attendance_events').get();
    assert.equal(row.date, todayISO(yesterday));
    // sending it again (the station retried) is a harmless duplicate
    assert.equal((await (await send('POST', '/api/gate/scan', admin, body)).json()).outcome, 'duplicate');
    // and today is still open for a scan
    assert.equal((await (await send('POST', '/api/gate/scan', admin, { cardUid: student.cardUid })).json()).outcome, 'recorded');
  });

  test('a scan time in the future is refused', async () => {
    const student = await (await enrol({ fullName: 'Amina Hassan' })).json();
    const res = await send('POST', '/api/gate/scan', admin, {
      cardUid: student.cardUid, scannedAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(res.status, 422);
  });
});

describe('teacher invites by email', () => {
  test('the invite is emailed with a set-up link and no code', async () => {
    const res = await send('POST', '/api/admin/schools/school-1/teachers', admin, { fullName: 'Ms. Otieno', email: 'otieno@kibera.ac.ke' });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.emailSent, true);
    const [email] = mailer.outbox();
    assert.equal(email.to, 'otieno@kibera.ac.ke');
    assert.match(email.link, /#\/set-password\//);
    assert.ok(!email.text.includes(body.code), 'only the link, no code to type');

    const set = await send('POST', '/api/auth/set-password', { 'content-type': 'application/json' }, {
      token: email.link.split('/').pop(), password: 'teacher-pass-1',
    });
    const signedIn = await set.json();
    assert.equal(set.status, 200);
    assert.equal(signedIn.user.role, 'teacher');
    assert.equal(db.prepare(`SELECT status FROM users WHERE email = 'otieno@kibera.ac.ke'`).get().status, 'active');
  });

  test('a new code for a signed-up teacher emails a reset link', async () => {
    const { teacher, code } = await (await send('POST', '/api/admin/schools/school-1/teachers', admin, { fullName: 'Ms. Otieno', email: 'otieno@kibera.ac.ke' })).json();
    await send('POST', '/api/auth/setup', { 'content-type': 'application/json' }, { code, password: 'teacher-pass-1' });
    await send('POST', `/api/admin/teachers/${teacher.userId}/code`, admin, {});
    assert.match(mailer.outbox()[0].subject, /Reset your SmartAttend password/);
  });
});

describe('importing past attendance (demo tool)', () => {
  const importRows = (rows, classId = 'class-1', headers = admin) =>
    send('POST', `/api/admin/classes/${classId}/attendance/import`, headers, { rows });
  const marks = (adm) => db.prepare(
    `SELECT e.date, e.status, e.reason, e.source, e.synced_at IS NOT NULL AS synced
       FROM attendance_events e JOIN students s ON s.student_id = e.student_id
      WHERE s.admission_no = ? ORDER BY e.date`
  ).all(adm);

  test('enrols new admission numbers and adds their marks as demo data', async () => {
    const res = await importRows([
      { admissionNo: 'DM/001', fullName: 'Amina Hassan', date: '2026-05-04', status: 'present' },
      { admissionNo: 'DM/001', fullName: 'Amina Hassan', date: '2026-05-05', status: 'absent', absenceReason: 'fee' },
      { admissionNo: 'DM/002', fullName: 'Brian Otieno', date: '2026-05-04', status: 'absent' },
    ]);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { inserted: 3, skipped: 0, enrolled: 2 });
    assert.deepEqual(marks('DM/001'), [
      { date: '2026-05-04', status: 'present', reason: null, source: 'simulation', synced: 1 },
      { date: '2026-05-05', status: 'absent', reason: 'fee', source: 'simulation', synced: 1 },
    ]);
    const amina = db.prepare(`SELECT class_group_id, enrolled_at FROM students WHERE admission_no = 'DM/001'`).get();
    assert.deepEqual(amina, { class_group_id: 'class-1', enrolled_at: '2026-05-04' });
    assert.equal(db.prepare('SELECT count(*) AS n FROM sync_queue').get().n, 0);
  });

  test('re-importing skips days already marked and never overwrites them', async () => {
    await importRows([{ admissionNo: 'DM/001', fullName: 'Amina Hassan', date: '2026-05-04', status: 'present' }]);
    const res = await importRows([
      { admissionNo: 'dm/001', date: '2026-05-04', status: 'absent' },
      { admissionNo: 'DM/001', date: '2026-05-05', status: 'present' },
    ]);
    assert.deepEqual(await res.json(), { inserted: 1, skipped: 1, enrolled: 0 });
    assert.equal(marks('DM/001')[0].status, 'present');
  });

  test('a bad row saves nothing and names the row', async () => {
    const res = await importRows([
      { admissionNo: 'DM/001', fullName: 'Amina Hassan', date: '2026-05-04', status: 'present' },
      { admissionNo: 'DM/001', fullName: 'Amina Hassan', date: '2026-05-09', status: 'present' },
    ]);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /row 2: 2026-05-09 is a weekend/);
    assert.equal(marks('DM/001').length, 0);
    assert.equal(db.prepare(`SELECT count(*) AS n FROM students WHERE admission_no = 'DM/001'`).get().n, 0);
  });

  test('refuses future dates, unknown students without a name and students of another class', async () => {
    const future = await importRows([{ admissionNo: 'DM/001', fullName: 'Amina Hassan', date: '2099-01-05', status: 'present' }]);
    assert.match((await future.json()).error, /in the future/);

    const noName = await importRows([{ admissionNo: 'DM/009', date: '2026-05-04', status: 'present' }]);
    assert.match((await noName.json()).error, /add a name/);

    await enrol({ fullName: 'Brian Otieno', admissionNo: 'KB/002' }, 'class-2');
    const elsewhere = await importRows([{ admissionNo: 'KB/002', date: '2026-05-04', status: 'present' }]);
    assert.match((await elsewhere.json()).error, /in Form 2, not this class/);
  });

  test("another school's class is a 404", async () => {
    const res = await importRows([{ admissionNo: 'DM/001', fullName: 'Amina', date: '2026-05-04', status: 'present' }], 'class-x');
    assert.equal(res.status, 404);
  });
});
