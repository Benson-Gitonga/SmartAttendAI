import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { createSystemAdminAuth, hashPassword } from '../auth/systemAdminAuth.js';
import { testSystemAdminAuth, signInSystemAdmin, TEST_ADMIN } from '../auth/testing.js';

let db;
let server;
let base;
let token;

async function start(systemAdminAuth = testSystemAdminAuth()) {
  db = openDatabase(':memory:');
  server = createApp({ db, logger: false, systemAdminAuth }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  db.prepare(`INSERT INTO schools (school_id, name, county) VALUES ('school-1', 'Kibera Secondary', 'Nairobi')`).run();
  db.prepare(`INSERT INTO schools (school_id, name, county) VALUES ('school-2', 'Moi Girls', 'Nairobi')`).run();
  db.prepare(`INSERT INTO class_groups (class_group_id, school_id, grade, academic_year) VALUES ('class-a', 'school-1', 'Form 3', 2026)`).run();
  db.prepare(`INSERT INTO students (student_id, class_group_id, admission_no, full_name) VALUES ('stu-1', 'class-a', 'A/001', 'Test Student')`).run();
}

const login = (body) =>
  fetch(`${base}/api/system-admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const withToken = (path, init = {}, t = token) =>
  fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...init.headers } });

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('system admin sign-in', () => {
  beforeEach(() => start());

  test('the right username and password return a token that opens the school list', async () => {
    const res = await login({ username: '  SysAdmin ', password: TEST_ADMIN.password });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.username, TEST_ADMIN.username);
    assert.ok(body.expiresAt > Date.now());

    const list = await withToken('/api/system-admin/schools', {}, body.token);
    assert.equal(list.status, 200);
    assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'system_admin.signed_in'`).get());
  });

  test('a wrong password or username is a 401 with the same message', async () => {
    const wrongPassword = await login({ username: TEST_ADMIN.username, password: 'not it' });
    const wrongEmail = await login({ username: 'someone-else', password: TEST_ADMIN.password });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongEmail.status, 401);
    assert.deepEqual(await wrongPassword.json(), await wrongEmail.json());
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'system_admin.sign_in_failed'`).get().n, 2);
  });

  test('400 without a username or password', async () => {
    assert.equal((await login({ username: TEST_ADMIN.username })).status, 400);
    assert.equal((await login({ password: 'x' })).status, 400);
  });

  test('never sends the password hash back', async () => {
    const res = await login(TEST_ADMIN);
    const text = await res.text();
    assert.doesNotMatch(text, /scrypt/);
  });

  for (const [label, header] of [
    ['no token', undefined],
    ['a made-up token', 'Bearer abc.def'],
    ['a token without Bearer', 'nope'],
  ]) {
    test(`every school endpoint is a 401 with ${label}`, async () => {
      const headers = header ? { authorization: header } : {};
      const list = await fetch(`${base}/api/system-admin/schools`, { headers });
      const approve = await fetch(`${base}/api/system-admin/schools/school-1/disable`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}',
      });
      assert.equal(list.status, 401);
      assert.equal(approve.status, 401);
      assert.equal(db.prepare(`SELECT status FROM schools WHERE school_id = 'school-1'`).get().status, 'active');
    });
  }

  test('a token from a server with another secret is refused', async () => {
    const elsewhere = createSystemAdminAuth({ username: TEST_ADMIN.username, passwordHash: hashPassword('pw'), tokenSecret: 'other' });
    const { token: foreign } = elsewhere.signIn(TEST_ADMIN.username, 'pw');
    assert.equal((await withToken('/api/system-admin/schools', {}, foreign)).status, 401);
  });

  test('GET /me says who is signed in', async () => {
    token = await signInSystemAdmin(base);
    const res = await withToken('/api/system-admin/me');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).username, TEST_ADMIN.username);
  });
});

describe('system admin sign-in lockout and expiry', () => {
  test('five wrong passwords lock the address out, even for the right password', async () => {
    let clock = Date.now();
    await start(testSystemAdminAuth({ maxFailures: 5, lockoutMs: 60_000, now: () => clock }));
    for (let i = 0; i < 4; i += 1) assert.equal((await login({ username: TEST_ADMIN.username, password: 'bad' })).status, 401);

    const fifth = await login({ username: TEST_ADMIN.username, password: 'bad' });
    assert.equal(fifth.status, 429);
    assert.ok(Number(fifth.headers.get('retry-after')) > 0);
    assert.equal((await login(TEST_ADMIN)).status, 429);

    clock += 61_000;
    assert.equal((await login(TEST_ADMIN)).status, 200);
  });

  test('a token stops working once it expires', async () => {
    let clock = Date.now();
    await start(testSystemAdminAuth({ tokenTtlMs: 1000, now: () => clock }));
    token = await signInSystemAdmin(base);
    assert.equal((await withToken('/api/system-admin/schools')).status, 200);
    clock += 1001;
    assert.equal((await withToken('/api/system-admin/schools')).status, 401);
  });

  test('a server with no system admin set up answers 503', async () => {
    await start(createSystemAdminAuth({}));
    assert.equal((await login(TEST_ADMIN)).status, 503);
    assert.equal((await fetch(`${base}/api/system-admin/schools`)).status, 503);
  });
});

describe('GET /api/system-admin/schools', () => {
  beforeEach(async () => {
    await start();
    token = await signInSystemAdmin(base);
  });

  test('lists every school with counts and default active status', async () => {
    const res = await withToken('/api/system-admin/schools');
    const { schools } = await res.json();
    assert.equal(res.status, 200);
    assert.equal(schools.length, 2);
    const s1 = schools.find((s) => s.schoolId === 'school-1');
    assert.equal(s1.status, 'active');
    assert.equal(s1.classCount, 1);
    assert.equal(s1.studentCount, 1);
  });
});

describe('POST /api/system-admin/schools/:id/status', () => {
  beforeEach(async () => {
    await start();
    token = await signInSystemAdmin(base);
  });

  const setStatus = (id, status) =>
    withToken(`/api/system-admin/schools/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });

  test('deactivates a school and records who did it', async () => {
    const res = await setStatus('school-1', 'inactive');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'inactive');
    assert.equal(body.reviewedBy, TEST_ADMIN.username);
  });

  test('404 for an unknown school', async () => {
    assert.equal((await setStatus('nope', 'inactive')).status, 404);
  });

  test('400 for an invalid status', async () => {
    assert.equal((await setStatus('school-1', 'disabled')).status, 400);
  });
});
