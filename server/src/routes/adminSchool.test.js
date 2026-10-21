import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { createUser, recordAttendance, todayISO } from '../db/repository.js';
import { testUserAuth, staffHeaders } from '../auth/testing.js';

let db;
let server;
let base;
let admin; // headers
let teacher; // headers
let teacherId;
let otherTeacherId;

const TODAY = todayISO();
const api = (path, headers, init = {}) => fetch(`${base}${path}`, { ...init, headers });
const send = (method, path, headers, body) => api(path, headers, { method, body: JSON.stringify(body) });

beforeEach(async () => {
  db = openDatabase(':memory:');
  const userAuth = testUserAuth(db);
  server = createApp({ db, logger: false, userAuth }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  db.prepare(`INSERT INTO schools (school_id, name) VALUES ('school-1', 'School One'), ('school-2', 'School Two')`).run();
  admin = staffHeaders(db, userAuth, { schoolId: 'school-1', role: 'admin', email: 'admin@one.ke' });
  teacher = staffHeaders(db, userAuth, { schoolId: 'school-1', role: 'teacher', email: 'otieno@one.ke' });
  teacherId = db.prepare(`SELECT user_id FROM users WHERE email = 'otieno@one.ke'`).get().user_id;
  otherTeacherId = createUser(db, { email: 'kamau@two.ke', fullName: 'Mr. Kamau', role: 'teacher', schoolId: 'school-2' }).userId;
  db.prepare(`UPDATE users SET full_name = 'Ms. Otieno' WHERE user_id = ?`).run(teacherId);

  // Two classes: 3A belongs to Ms. Otieno, 4B has no teacher yet.
  db.prepare(`INSERT INTO class_groups (class_group_id, school_id, grade, stream, academic_year, teacher_user_id)
              VALUES ('class-3a', 'school-1', 'Form 3', 'A', 2026, ?), ('class-4b', 'school-1', 'Form 4', 'B', 2026, NULL)`).run(teacherId);
  db.prepare(`INSERT INTO students (student_id, class_group_id, admission_no, full_name) VALUES
              ('stu-1', 'class-3a', 'A/1', 'Amina'), ('stu-2', 'class-3a', 'A/2', 'Brian'), ('stu-3', 'class-3a', 'A/3', 'Chebet'),
              ('stu-4', 'class-4b', 'B/1', 'Daudi')`).run();
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe("GET /api/admin/schools/:id/today, the day's register board", () => {
  test('shows which classes have taken the register', async () => {
    recordAttendance(db, { studentId: 'stu-1', date: TODAY, captureMethod: 'rfid', source: 'simulation' });
    recordAttendance(db, { studentId: 'stu-2', date: TODAY, captureMethod: 'rfid', source: 'simulation' });

    const res = await api('/api/admin/schools/school-1/today', admin);
    const board = await res.json();
    assert.equal(res.status, 200);
    const byId = Object.fromEntries(board.classes.map((c) => [c.classGroupId, c]));
    assert.equal(byId['class-3a'].status, 'gate_only', 'two gate scans, no roll call yet');
    assert.equal(byId['class-3a'].teacherName, 'Ms. Otieno');
    assert.equal(byId['class-3a'].unmarked, 1);
    assert.equal(byId['class-4b'].status, 'not_taken');
    assert.equal(board.totals.waiting, 2);
    assert.equal(board.totals.present, 2);
  });

  test('a class is done once every student has a mark', async () => {
    for (const id of ['stu-1', 'stu-2', 'stu-3']) {
      recordAttendance(db, { studentId: id, date: TODAY, captureMethod: 'manual', status: id === 'stu-3' ? 'absent' : 'present' });
    }
    const board = await (await api('/api/admin/schools/school-1/today', admin)).json();
    const cls = board.classes.find((c) => c.classGroupId === 'class-3a');
    assert.equal(cls.status, 'done');
    assert.equal(cls.absent, 1);
    assert.equal(board.totals.done, 1);
  });

  test('400 for a future date or a bad one', async () => {
    assert.equal((await api('/api/admin/schools/school-1/today?date=2999-01-01', admin)).status, 400);
    assert.equal((await api('/api/admin/schools/school-1/today?date=yesterday', admin)).status, 400);
  });
});

describe('classes and teachers', () => {
  test('the admin creates a class with its teacher', async () => {
    const res = await send('POST', '/api/admin/schools/school-1/classes', admin, { grade: 'Form 1', stream: 'C', teacherUserId: teacherId });
    const cls = await res.json();
    assert.equal(res.status, 201);
    assert.match(cls.classGroupId, /^class-/);
    assert.equal(cls.teacherUserId, teacherId);
    assert.equal(cls.teacherName, 'Ms. Otieno');
    assert.equal(cls.academicYear, new Date().getFullYear());
  });

  test("400 for a teacher from another school, and the class isn't made", async () => {
    const res = await send('POST', '/api/admin/schools/school-1/classes', admin, { grade: 'Form 1', teacherUserId: otherTeacherId });
    assert.equal(res.status, 400);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM class_groups WHERE grade = 'Form 1'`).get().n, 0);
  });

  test('assign, change and remove a class teacher', async () => {
    let res = await send('PATCH', '/api/admin/classes/class-4b', admin, { teacherUserId: teacherId });
    assert.equal((await res.json()).teacherName, 'Ms. Otieno');
    res = await send('PATCH', '/api/admin/classes/class-4b', admin, { teacherUserId: null });
    const cls = await res.json();
    assert.equal(cls.teacherUserId, null);
    assert.equal(cls.teacherName, null);
  });

  test('lists teachers with the classes they teach', async () => {
    const { teachers } = await (await api('/api/admin/schools/school-1/teachers', admin)).json();
    assert.equal(teachers.length, 1);
    assert.equal(teachers[0].fullName, 'Ms. Otieno');
    assert.deepEqual(teachers[0].classes.map((c) => c.classGroupId), ['class-3a']);
  });

  test("teachers can't use any of it", async () => {
    assert.equal((await api('/api/admin/schools/school-1/today', teacher)).status, 403);
    assert.equal((await send('POST', '/api/admin/schools/school-1/classes', teacher, { grade: 'Form 1' })).status, 403);
  });

  test("another school's class is a 404", async () => {
    db.prepare(`INSERT INTO class_groups (class_group_id, school_id, grade, academic_year) VALUES ('class-x', 'school-2', 'Form 1', 2026)`).run();
    assert.equal((await send('PATCH', '/api/admin/classes/class-x', admin, { grade: 'Hacked' })).status, 404);
    assert.equal((await api('/api/admin/classes/class-x/register', admin)).status, 404);
  });
});

describe('taking or correcting a register', () => {
  const override = (body) => send('PUT', '/api/admin/classes/class-3a/register', admin, { date: TODAY, ...body });

  test('the admin takes the register for an absent teacher', async () => {
    const res = await override({
      reason: 'teacher_absent',
      marks: [
        { studentId: 'stu-1', status: 'present' },
        { studentId: 'stu-2', status: 'absent', absenceReason: 'health' },
        { studentId: 'stu-3', status: 'late' },
      ],
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.changed, ['stu-1', 'stu-2', 'stu-3']);

    const brian = body.students.find((s) => s.studentId === 'stu-2');
    assert.equal(brian.mark.status, 'absent');
    assert.equal(brian.mark.absenceReason, 'health');
    assert.equal(brian.mark.recordedBy, 'admin@one.ke');
    assert.deepEqual(
      { reason: brian.override.reason, actor: brian.override.actor, onBehalfOf: brian.override.onBehalfOf, fromStatus: brian.override.fromStatus },
      { reason: 'teacher_absent', actor: 'admin@one.ke', onBehalfOf: 'Ms. Otieno', fromStatus: null }
    );
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sync_queue`).get().n, 3, 'every mark goes up to the cloud');
    assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'attendance.overridden'`).get());
  });

  test("correcting a teacher's mark keeps the record and logs what it was", async () => {
    const original = recordAttendance(db, { studentId: 'stu-1', date: TODAY, captureMethod: 'manual', status: 'absent', recordedBy: 'otieno@one.ke' });
    db.prepare(`UPDATE sync_queue SET status = 'synced'`).run();

    const res = await override({ reason: 'wrong_mark', note: 'She was in the library', marks: [{ studentId: 'stu-1', status: 'present' }] });
    assert.equal(res.status, 200);

    const row = db.prepare(`SELECT * FROM attendance_events WHERE student_id = 'stu-1'`).get();
    assert.equal(row.event_id, original.eventId, 'same record, updated in place');
    assert.equal(row.status, 'present');
    const log = db.prepare(`SELECT * FROM attendance_overrides WHERE student_id = 'stu-1'`).get();
    assert.equal(log.from_status, 'absent');
    assert.equal(log.to_status, 'present');
    assert.equal(log.note, 'She was in the library');
    assert.equal(db.prepare(`SELECT status FROM sync_queue WHERE event_id = ?`).get(original.eventId).status, 'pending', 'sent to the cloud again');
  });

  test('the correction reaches the teacher through the gate pull', async () => {
    recordAttendance(db, { studentId: 'stu-1', date: TODAY, captureMethod: 'manual', status: 'absent' });
    await override({ reason: 'wrong_mark', marks: [{ studentId: 'stu-1', status: 'present' }] });
    const { records } = await (await api('/api/gate/classes/class-3a/attendance', teacher)).json();
    assert.equal(records.find((r) => r.studentId === 'stu-1').status, 'present');
  });

  test('a mark that already matches is left alone', async () => {
    recordAttendance(db, { studentId: 'stu-1', date: TODAY, captureMethod: 'manual', status: 'present' });
    const body = await (await override({ reason: 'wrong_mark', marks: [{ studentId: 'stu-1', status: 'present' }] })).json();
    assert.deepEqual(body.unchanged, ['stu-1']);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM attendance_overrides`).get().n, 0);
  });

  test('an earlier day can be corrected too', async () => {
    const res = await override({ date: '2026-09-01', reason: 'late_arrival', marks: [{ studentId: 'stu-3', status: 'late' }] });
    assert.equal(res.status, 200);
    assert.equal(db.prepare(`SELECT date FROM attendance_events WHERE student_id = 'stu-3'`).get().date, '2026-09-01');
  });

  for (const [label, body, status] of [
    ['no reason', { reason: undefined, marks: [{ studentId: 'stu-1', status: 'present' }] }, 400],
    ['"other" without a note', { reason: 'other', marks: [{ studentId: 'stu-1', status: 'present' }] }, 400],
    ['a reason that is not on the list', { reason: 'felt_like_it', marks: [{ studentId: 'stu-1', status: 'present' }] }, 400],
    ['a future date', { date: '2999-01-01', reason: 'wrong_mark', marks: [{ studentId: 'stu-1', status: 'present' }] }, 400],
    ['a student from another class', { reason: 'wrong_mark', marks: [{ studentId: 'stu-4', status: 'present' }] }, 400],
    ['no marks', { reason: 'wrong_mark', marks: [] }, 400],
  ]) {
    test(`refuses ${label}, and changes nothing`, async () => {
      const res = await override(body);
      assert.equal(res.status, status);
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM attendance_events`).get().n, 0);
    });
  }

  test('"other" with a note is fine', async () => {
    const res = await override({ reason: 'other', note: 'Sports day', marks: [{ studentId: 'stu-1', status: 'present' }] });
    assert.equal(res.status, 200);
  });
});

describe('the teacher side', () => {
  test("a teacher downloads the classes they're assigned, with students", async () => {
    const res = await api('/api/teacher/classes', teacher);
    const { classes } = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(classes.map((c) => c.classGroupId), ['class-3a']);
    assert.deepEqual(classes[0].students.map((s) => s.fullName), ['Amina', 'Brian', 'Chebet']);
  });

  test("a teacher downloads their class's attendance from a date on", async () => {
    recordAttendance(db, { studentId: 'stu-1', date: '2026-09-01', status: 'absent', captureMethod: 'manual' });
    recordAttendance(db, { studentId: 'stu-2', date: '2026-09-02', captureMethod: 'manual' });
    recordAttendance(db, { studentId: 'stu-4', date: '2026-09-02', captureMethod: 'manual' }); // another class

    const res = await api('/api/teacher/classes/class-3a/attendance?since=2026-09-02', teacher);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.records.map((r) => [r.studentId, r.date, r.status]), [['stu-2', '2026-09-02', 'present']]);
  });

  test("a teacher cannot download another class's attendance", async () => {
    assert.equal((await api('/api/teacher/classes/class-4b/attendance', teacher)).status, 404);
    assert.equal((await api('/api/teacher/classes/class-3a/attendance?since=last-week', teacher)).status, 400);
  });

  test('an admin cannot use the teacher download', async () => {
    assert.equal((await api('/api/teacher/classes', admin)).status, 403);
  });

  test('a teacher cannot create classes or schools any more', async () => {
    assert.equal((await send('POST', '/api/roster/classes', teacher, { classGroupId: 'class-new', schoolId: 'school-1', grade: 'Form 2' })).status, 403);
    assert.equal((await send('POST', '/api/roster/schools', teacher, { schoolId: 'school-1', name: 'x' })).status, 403);
  });

  test('a teacher cannot add, edit or issue cards to students, even in their own class', async () => {
    assert.equal((await send('POST', '/api/roster/students', teacher, { studentId: 'stu-9', classGroupId: 'class-3a', fullName: 'New' })).status, 403);
    assert.equal((await send('PATCH', '/api/roster/students/stu-1', teacher, { fullName: 'Changed' })).status, 403);
    assert.equal((await send('POST', '/api/roster/students/stu-1/card', teacher, { cardUid: 'AABBCCDD' })).status, 403);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM students WHERE student_id = 'stu-9'`).get().n, 0);
  });
});
