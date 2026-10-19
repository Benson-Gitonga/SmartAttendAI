import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { testUserAuth, staffHeaders } from '../auth/testing.js';

let db;
let server;
let base;
let userAuth;
let headers; // made on the first request of each test

// Requests from a signed-in school admin of school-1, who sets up classes.
const SCHOOL = 'school-1';
const api = (p, init = {}) => {
  if (!headers) {
    db.prepare('INSERT OR IGNORE INTO schools (school_id, name) VALUES (?, ?)').run(SCHOOL, 'Test School');
    headers = staffHeaders(db, userAuth, { schoolId: SCHOOL, role: 'admin' });
  }
  return fetch(`${base}${p}`, { ...init, headers: { ...headers, ...init.headers } });
};

beforeEach(async () => {
  db = openDatabase(':memory:');
  userAuth = testUserAuth(db);
  headers = undefined;
  server = createApp({ db, userAuth, logger: false }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });

async function pushSchoolAndClass() {
  await post('/api/roster/schools', { schoolId: 'school-1', name: 'Test School' });
  await post('/api/roster/classes', { classGroupId: 'class-1', schoolId: 'school-1', grade: 'Form 3', stream: 'A', teacherName: 'Ms. Otieno' });
}

describe('POST /api/roster/schools', () => {
  test('creates a school, upsert on repeat', async () => {
    const res1 = await post('/api/roster/schools', { schoolId: 'school-1', name: 'Test School' });
    assert.equal(res1.status, 200);
    const res2 = await post('/api/roster/schools', { schoolId: 'school-1', name: 'Renamed School' });
    assert.equal(res2.status, 200);
    assert.equal(db.prepare('SELECT name FROM schools WHERE school_id = ?').get('school-1').name, 'Renamed School');
  });

  test('400 on missing fields', async () => {
    const res = await post('/api/roster/schools', { schoolId: 'school-1' });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/roster/classes', () => {
  test('creates a class under a school', async () => {
    await post('/api/roster/schools', { schoolId: 'school-1', name: 'Test School' });
    const res = await post('/api/roster/classes', { classGroupId: 'class-1', schoolId: 'school-1', grade: 'Form 3', teacherName: 'Ms. Otieno' });
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT teacher_name FROM class_groups WHERE class_group_id = ?').get('class-1').teacher_name, 'Ms. Otieno');
  });

  test("403 for a class in a school that is not the sender's", async () => {
    const res = await post('/api/roster/classes', { classGroupId: 'class-1', schoolId: 'nope', grade: 'Form 3' });
    assert.equal(res.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class_groups').get().n, 0);
  });

  test('PATCH updates fields in place', async () => {
    await pushSchoolAndClass();
    const res = await patch('/api/roster/classes/class-1', { teacherName: 'Mr. Kamau' });
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT teacher_name FROM class_groups WHERE class_group_id = ?').get('class-1').teacher_name, 'Mr. Kamau');
  });
});

describe('POST /api/roster/students', () => {
  test('creates a student under a class', async () => {
    await pushSchoolAndClass();
    const res = await post('/api/roster/students', { studentId: 'stu-1', classGroupId: 'class-1', fullName: 'Amina Wanjiru', admissionNo: '3A/001' });
    assert.equal(res.status, 200);
    const row = db.prepare('SELECT * FROM students WHERE student_id = ?').get('stu-1');
    assert.equal(row.full_name, 'Amina Wanjiru');
    assert.equal(row.active, 1);
  });

  test('stores guardian phone and email', async () => {
    await pushSchoolAndClass();
    await post('/api/roster/students', {
      studentId: 'stu-1', classGroupId: 'class-1', fullName: 'Amina', guardianPhone: '0712345678', guardianEmail: 'g@example.com',
    });
    const row = db.prepare('SELECT guardian_phone, guardian_email FROM students WHERE student_id = ?').get('stu-1');
    assert.equal(row.guardian_phone, '0712345678');
    assert.equal(row.guardian_email, 'g@example.com');

    await patch('/api/roster/students/stu-1', { guardianPhone: '0700000000' });
    assert.equal(db.prepare('SELECT guardian_phone FROM students WHERE student_id = ?').get('stu-1').guardian_phone, '0700000000');
  });

  test('409 when the class does not exist', async () => {
    const res = await post('/api/roster/students', { studentId: 'stu-1', classGroupId: 'nope', fullName: 'Amina' });
    assert.equal(res.status, 409);
  });

  test('PATCH can deactivate a student (removal)', async () => {
    await pushSchoolAndClass();
    await post('/api/roster/students', { studentId: 'stu-1', classGroupId: 'class-1', fullName: 'Amina Wanjiru' });
    const res = await patch('/api/roster/students/stu-1', { active: false });
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT active FROM students WHERE student_id = ?').get('stu-1').active, 0);
  });
});

describe('POST /api/roster/students/:id/card', () => {
  test('assigns a card, only one active card per student', async () => {
    await pushSchoolAndClass();
    await post('/api/roster/students', { studentId: 'stu-1', classGroupId: 'class-1', fullName: 'Amina' });
    await post('/api/roster/students/stu-1/card', { cardUid: 'AAAAAAAA' });
    const res = await post('/api/roster/students/stu-1/card', { cardUid: 'BBBBBBBB' });
    assert.equal(res.status, 200);
    const active = db.prepare('SELECT card_uid FROM rfid_cards WHERE student_id = ? AND active = 1').all('stu-1');
    assert.equal(active.length, 1);
    assert.equal(active[0].card_uid, 'BBBBBBBB');
  });
});

describe('roster sign-in and school boundaries', () => {
  test('401 without signing in', async () => {
    const res = await fetch(`${base}/api/roster/schools`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schoolId: 'school-1', name: 'x' }),
    });
    assert.equal(res.status, 401);
  });

  test("a teacher from another school cannot change this school's students", async () => {
    await pushSchoolAndClass();
    await post('/api/roster/students', { studentId: 'stu-1', classGroupId: 'class-1', fullName: 'Amina' });

    db.prepare(`INSERT INTO schools (school_id, name) VALUES ('school-2', 'Other School')`).run();
    const outsider = staffHeaders(db, userAuth, { schoolId: 'school-2', role: 'teacher' });
    const send = (path, method, body) => fetch(`${base}${path}`, { method, headers: outsider, body: JSON.stringify(body) });

    assert.equal((await send('/api/roster/students/stu-1', 'PATCH', { fullName: 'Changed' })).status, 403);
    assert.equal((await send('/api/roster/students/stu-1/card', 'POST', { cardUid: '04AABBCC' })).status, 403);
    assert.equal((await send('/api/roster/students', 'POST', { studentId: 'stu-x', classGroupId: 'class-1', fullName: 'Spy' })).status, 403);
    assert.equal(db.prepare(`SELECT full_name FROM students WHERE student_id = 'stu-1'`).get().full_name, 'Amina');
  });
});
