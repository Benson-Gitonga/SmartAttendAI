import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { createUser } from '../db/repository.js';
import { hashPassword } from '../auth/systemAdminAuth.js';
import { testUserAuth, testSystemAdminAuth, signInSystemAdmin } from '../auth/testing.js';

let db;
let server;
let base;
let clock;

const PASSWORD = 'correct horse battery';
const HASH = hashPassword(PASSWORD);

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const login = (email, password = PASSWORD) => post('/api/auth/login', { email, password });
const bearer = (token) => ({ authorization: `Bearer ${token}` });
async function tokenFor(email) {
  const res = await login(email);
  assert.equal(res.status, 200, `sign-in for ${email}`);
  return (await res.json()).token;
}

beforeEach(async () => {
  clock = Date.now();
  db = openDatabase(':memory:');
  const userAuth = testUserAuth(db, { maxFailures: 3, lockoutMs: 60_000, tokenTtlMs: 60_000, now: () => clock });
  server = createApp({ db, logger: false, userAuth, systemAdminAuth: testSystemAdminAuth() }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Two active schools, each with an admin, a teacher, a class and a student.
  for (const n of [1, 2]) {
    db.prepare(`INSERT INTO schools (school_id, name, county) VALUES (?, ?, 'Nairobi')`).run(`school-${n}`, `School ${n}`);
    db.prepare(`INSERT INTO class_groups (class_group_id, school_id, grade, academic_year) VALUES (?, ?, 'Form 1', 2026)`)
      .run(`class-${n}`, `school-${n}`);
    db.prepare(`INSERT INTO students (student_id, class_group_id, admission_no, full_name) VALUES (?, ?, ?, ?)`)
      .run(`stu-${n}`, `class-${n}`, `A/00${n}`, `Student ${n}`);
    createUser(db, { email: `admin${n}@school.ke`, fullName: `Admin ${n}`, role: 'admin', schoolId: `school-${n}`, passwordHash: HASH });
    createUser(db, { email: `teacher${n}@school.ke`, fullName: `Teacher ${n}`, role: 'teacher', schoolId: `school-${n}`, passwordHash: HASH });
  }
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('POST /api/auth/login', () => {
  test('the right password returns a token, the user and their school', async () => {
    const res = await login('  ADMIN1@school.ke ');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.token);
    assert.deepEqual(
      { email: body.user.email, role: body.user.role, schoolId: body.user.schoolId },
      { email: 'admin1@school.ke', role: 'admin', schoolId: 'school-1' }
    );
    assert.equal(body.school.status, 'active');
    assert.equal(body.user.passwordHash, undefined);
    assert.ok(db.prepare(`SELECT last_sign_in_at FROM users WHERE email = 'admin1@school.ke'`).get().last_sign_in_at);
  });

  test('a wrong password and an unknown email get the same answer', async () => {
    const wrongPassword = await login('admin1@school.ke', 'nope');
    const unknown = await login('nobody@school.ke');
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await wrongPassword.json(), await unknown.json());
  });

  test('repeated wrong passwords lock that email out for a while', async () => {
    for (let i = 0; i < 2; i += 1) assert.equal((await login('teacher1@school.ke', 'nope')).status, 401);
    assert.equal((await login('teacher1@school.ke', 'nope')).status, 429);
    assert.equal((await login('teacher1@school.ke')).status, 429, 'even the right password waits');
    assert.equal((await login('teacher2@school.ke')).status, 200, 'other accounts are not affected');
    clock += 61_000;
    assert.equal((await login('teacher1@school.ke')).status, 200);
  });

  test('a disabled account cannot sign in', async () => {
    db.prepare(`UPDATE users SET status = 'disabled' WHERE email = 'teacher1@school.ke'`).run();
    const res = await login('teacher1@school.ke');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'disabled');
  });

  test('400 without an email or password', async () => {
    assert.equal((await post('/api/auth/login', { email: 'a@b.ke' })).status, 400);
  });
});

describe('tokens', () => {
  test('GET /me returns the signed-in user', async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: bearer(await tokenFor('teacher2@school.ke')) });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.user.email, 'teacher2@school.ke');
    assert.equal(body.school.name, 'School 2');
    assert.ok(body.school.submittedAt, 'when the school applied');
    assert.equal(body.school.reviewedAt, null);
  });

  test('disabling an account stops its token at once', async () => {
    const token = await tokenFor('teacher1@school.ke');
    db.prepare(`UPDATE users SET status = 'disabled' WHERE email = 'teacher1@school.ke'`).run();
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: bearer(token) })).status, 401);
  });

  test('a token stops working once it expires', async () => {
    const token = await tokenFor('teacher1@school.ke');
    clock += 61_000;
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: bearer(token) })).status, 401);
  });

  test('a system admin token is not a staff token', async () => {
    const sysToken = await signInSystemAdmin(base);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: bearer(sysToken) })).status, 401);
    assert.equal((await fetch(`${base}/api/admin/schools/school-1/overview`, { headers: bearer(sysToken) })).status, 401);
  });
});

describe('every school only sees itself', () => {
  test('nothing works without signing in', async () => {
    for (const path of ['/api/admin/schools/school-1/overview', '/api/gate/classes/class-1/attendance', '/api/auth/me']) {
      assert.equal((await fetch(`${base}${path}`)).status, 401, path);
    }
    assert.equal((await post('/api/sync', { records: [] })).status, 401);
    assert.equal((await post('/api/roster/schools', { schoolId: 'school-1', name: 'x' })).status, 401);
  });

  test("a school admin cannot read another school's dashboard, classes or students", async () => {
    const headers = bearer(await tokenFor('admin1@school.ke'));
    assert.equal((await fetch(`${base}/api/admin/schools/school-1/overview`, { headers })).status, 200);
    for (const path of [
      '/api/admin/schools/school-2/overview',
      '/api/admin/schools/school-2/flagged',
      '/api/admin/classes/class-2/students',
      '/api/admin/students/stu-2/follow-ups',
    ]) {
      assert.equal((await fetch(`${base}${path}`, { headers })).status, 404, path);
    }
    const log = await post('/api/admin/students/stu-2/follow-ups', { flag: 'red', method: 'sms' }, headers);
    assert.equal(log.status, 404);
  });

  test('a follow-up is logged against whoever is signed in', async () => {
    const headers = bearer(await tokenFor('admin1@school.ke'));
    const res = await post('/api/admin/students/stu-1/follow-ups', { flag: 'red', method: 'sms', actor: 'someone-else' }, headers);
    assert.equal(res.status, 201);
    assert.equal(db.prepare('SELECT actor FROM follow_ups').get().actor, 'admin1@school.ke');
  });

  test('a teacher cannot use the school admin pages', async () => {
    const headers = bearer(await tokenFor('teacher1@school.ke'));
    assert.equal((await fetch(`${base}/api/admin/schools/school-1/overview`, { headers })).status, 403);
  });

  test("a teacher cannot pull another school's gate list", async () => {
    const headers = bearer(await tokenFor('teacher1@school.ke'));
    assert.equal((await fetch(`${base}/api/gate/classes/class-1/attendance`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/gate/classes/class-2/attendance`, { headers })).status, 404);
  });

  test("a teacher cannot sync attendance for another school's student", async () => {
    const headers = bearer(await tokenFor('teacher1@school.ke'));
    const record = (studentId) => ({
      eventId: randomUUID(), studentId, date: '2026-10-19', status: 'present', createdAt: new Date().toISOString(),
    });
    const foreign = await post('/api/sync', { records: [record('stu-1'), record('stu-2')] }, headers);
    assert.equal(foreign.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_events').get().n, 0, 'nothing from the batch is kept');

    const own = await post('/api/sync', { records: [record('stu-1')] }, headers);
    assert.equal(own.status, 200);
    assert.equal(db.prepare('SELECT recorded_by FROM attendance_events').get().recorded_by, 'teacher1@school.ke');
  });

  test('the platform-wide debug lists are for the system admin only', async () => {
    const staff = bearer(await tokenFor('admin1@school.ke'));
    for (const path of ['/api/students', '/api/attendance', '/api/challenges', '/api/stats']) {
      assert.equal((await fetch(`${base}${path}`)).status, 401, path);
      assert.equal((await fetch(`${base}${path}`, { headers: staff })).status, 401, `${path} as staff`);
    }
    const sys = bearer(await signInSystemAdmin(base));
    assert.equal((await fetch(`${base}/api/students`, { headers: sys })).status, 200);
  });
});

describe('POST /api/auth/refresh', () => {
  test('a signed-in device gets a new token for the same account', async () => {
    const token = await tokenFor('teacher1@school.ke');
    clock += 30_000;
    const res = await post('/api/auth/refresh', {}, bearer(token));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.token && body.token !== token);
    assert.equal(body.user.email, 'teacher1@school.ke');
  });

  test('401 without a token', async () => {
    assert.equal((await post('/api/auth/refresh', {})).status, 401);
  });
});
