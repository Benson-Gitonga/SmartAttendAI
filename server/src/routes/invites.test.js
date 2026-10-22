import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { issueSetupCode } from '../db/repository.js';
import { testUserAuth, staffHeaders } from '../auth/testing.js';
import { normalizeCode } from '../auth/setupCodes.js';

let db;
let server;
let base;
let admin;

const send = (method, path, body, headers = {}) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });

const invite = (body = {}) =>
  send('POST', '/api/admin/schools/school-1/teachers', { fullName: 'Ms. Otieno', email: 'Otieno@Kibera.ac.ke', phone: '0712345678', ...body }, admin);

beforeEach(async () => {
  db = openDatabase(':memory:');
  const userAuth = testUserAuth(db);
  server = createApp({ db, logger: false, userAuth }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db.prepare(`INSERT INTO schools (school_id, name) VALUES ('school-1', 'Kibera Secondary'), ('school-2', 'Other School')`).run();
  admin = staffHeaders(db, userAuth, { schoolId: 'school-1', role: 'admin', email: 'admin@kibera.ac.ke' });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('inviting a teacher', () => {
  test('creates a teacher with no password and a one-time code, shown once', async () => {
    const res = await invite();
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.match(body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(Date.parse(body.expiresAt) > Date.now() + 6 * 86_400_000, 'lasts about a week');
    assert.equal(body.teacher.status, 'invited');

    const user = db.prepare(`SELECT * FROM users WHERE email = 'otieno@kibera.ac.ke'`).get();
    assert.equal(user.role, 'teacher');
    assert.equal(user.password_hash, null);
    const stored = db.prepare('SELECT code_hash FROM setup_codes').get();
    assert.notEqual(stored.code_hash, normalizeCode(body.code), 'only a hash is kept');

    const { teachers } = await (await send('GET', '/api/admin/schools/school-1/teachers', undefined, admin)).json();
    assert.equal(teachers[0].openCode.purpose, 'invite');
    assert.equal(teachers[0].code, undefined, 'the code itself is never listed again');
  });

  test('an invited teacher can be given a class before they sign up', async () => {
    const { teacher } = await (await invite()).json();
    const res = await send('POST', '/api/admin/schools/school-1/classes', { grade: 'Form 1', teacherUserId: teacher.userId }, admin);
    assert.equal(res.status, 201);
  });

  test('409 for an email that already has an account', async () => {
    await invite();
    const res = await invite({ fullName: 'Someone Else' });
    assert.equal(res.status, 409);
  });

  for (const [label, body] of [['a bad email', { email: 'nope' }], ['no name', { fullName: '' }], ['a bad phone', { phone: '123' }]]) {
    test(`400 for ${label}`, async () => {
      assert.equal((await invite(body)).status, 400);
    });
  }

  test("teachers can't invite, and admins can't reach another school's teachers", async () => {
    const teacher = staffHeaders(db, testUserAuth(db), { schoolId: 'school-1', role: 'teacher' });
    assert.equal((await send('POST', '/api/admin/schools/school-1/teachers', { fullName: 'X Y', email: 'x@y.ke' }, teacher)).status, 403);
    const outsider = staffHeaders(db, testUserAuth(db), { schoolId: 'school-2', role: 'teacher', email: 'out@two.ke' });
    const outsiderId = db.prepare(`SELECT user_id FROM users WHERE email = 'out@two.ke'`).get().user_id;
    assert.ok(outsider);
    assert.equal((await send('POST', `/api/admin/teachers/${outsiderId}/code`, {}, admin)).status, 404);
    assert.equal((await send('POST', `/api/admin/teachers/${outsiderId}/disable`, {}, admin)).status, 404);
  });
});

describe('joining with the code', () => {
  test('the code says who it is for, then sets the password and signs in', async () => {
    const { code } = await (await invite()).json();

    const preview = await fetch(`${base}/api/auth/setup-codes/${encodeURIComponent(code.toLowerCase().replace('-', ' '))}`);
    const who = await preview.json();
    assert.equal(preview.status, 200, 'case and spacing do not matter');
    assert.deepEqual({ fullName: who.fullName, schoolName: who.schoolName, purpose: who.purpose }, { fullName: 'Ms. Otieno', schoolName: 'Kibera Secondary', purpose: 'invite' });

    const res = await send('POST', '/api/auth/setup', { code, password: 'otieno-2026' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.token);
    assert.equal(body.user.role, 'teacher');
    assert.equal(db.prepare(`SELECT status FROM users WHERE email = 'otieno@kibera.ac.ke'`).get().status, 'active');

    const login = await send('POST', '/api/auth/login', { email: 'otieno@kibera.ac.ke', password: 'otieno-2026' });
    assert.equal(login.status, 200, 'the new password works for a normal sign-in');
  });

  test('a code works once', async () => {
    const { code } = await (await invite()).json();
    await send('POST', '/api/auth/setup', { code, password: 'otieno-2026' });
    const again = await send('POST', '/api/auth/setup', { code, password: 'someone-else' });
    assert.equal(again.status, 410);
    assert.equal((await again.json()).state, 'used');
  });

  test('an expired code is refused', async () => {
    const { teacher } = await (await invite()).json();
    const { code } = issueSetupCode(db, { userId: teacher.userId, purpose: 'invite', ttlMs: -1000 });
    const res = await send('POST', '/api/auth/setup', { code, password: 'otieno-2026' });
    assert.equal(res.status, 410);
    assert.equal((await res.json()).state, 'expired');
  });

  test('a new code replaces the old one', async () => {
    const { teacher, code: first } = await (await invite()).json();
    const { code: second, purpose } = await (await send('POST', `/api/admin/teachers/${teacher.userId}/code`, {}, admin)).json();
    assert.equal(purpose, 'invite');
    assert.equal((await send('POST', '/api/auth/setup', { code: first, password: 'otieno-2026' })).status, 410);
    assert.equal((await send('POST', '/api/auth/setup', { code: second, password: 'otieno-2026' })).status, 200);
  });

  test('a wrong code is a 404 and a short password a 400', async () => {
    assert.equal((await fetch(`${base}/api/auth/setup-codes/ABCD-EFGH`)).status, 404);
    const { code } = await (await invite()).json();
    assert.equal((await send('POST', '/api/auth/setup', { code, password: 'short' })).status, 400);
  });

  test('guessing codes is cut off', async () => {
    let last;
    for (let i = 0; i < 11; i += 1) last = await fetch(`${base}/api/auth/setup-codes/ZZZZ-ZZZ${i % 9 + 2}`);
    assert.equal(last.status, 429);
  });
});

describe('password resets and disabling', () => {
  async function activeTeacher() {
    const { teacher, code } = await (await invite()).json();
    await send('POST', '/api/auth/setup', { code, password: 'otieno-2026' });
    return teacher;
  }

  test('a new code for an active teacher resets their password', async () => {
    const teacher = await activeTeacher();
    const { code, purpose } = await (await send('POST', `/api/admin/teachers/${teacher.userId}/code`, {}, admin)).json();
    assert.equal(purpose, 'reset');
    assert.equal((await send('POST', '/api/auth/setup', { code, password: 'brand-new-pass' })).status, 200);
    assert.equal((await send('POST', '/api/auth/login', { email: 'otieno@kibera.ac.ke', password: 'otieno-2026' })).status, 401);
    assert.equal((await send('POST', '/api/auth/login', { email: 'otieno@kibera.ac.ke', password: 'brand-new-pass' })).status, 200);
  });

  test('disabling signs the teacher out at once and kills their code; enabling lets them back', async () => {
    const teacher = await activeTeacher();
    const { token } = await (await send('POST', '/api/auth/login', { email: 'otieno@kibera.ac.ke', password: 'otieno-2026' })).json();
    const { code } = await (await send('POST', `/api/admin/teachers/${teacher.userId}/code`, {}, admin)).json();

    const off = await send('POST', `/api/admin/teachers/${teacher.userId}/disable`, {}, admin);
    assert.equal((await off.json()).status, 'disabled');
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    assert.equal((await send('POST', '/api/auth/setup', { code, password: 'x'.repeat(10) })).status, 410);
    assert.equal((await send('POST', `/api/admin/teachers/${teacher.userId}/code`, {}, admin)).status, 409);

    const on = await send('POST', `/api/admin/teachers/${teacher.userId}/enable`, {}, admin);
    assert.equal((await on.json()).status, 'active');
    assert.equal((await send('POST', '/api/auth/login', { email: 'otieno@kibera.ac.ke', password: 'otieno-2026' })).status, 200);
  });

  test('disabling frees the email for a new invite, and then the old account cannot be enabled', async () => {
    const teacher = await activeTeacher();
    await send('POST', `/api/admin/teachers/${teacher.userId}/disable`, {}, admin);

    const { teachers } = await (await send('GET', '/api/admin/schools/school-1/teachers', undefined, admin)).json();
    assert.equal(teachers.find((t) => t.userId === teacher.userId)?.email, 'otieno@kibera.ac.ke', 'still shown with their email');

    const again = await invite();
    assert.equal(again.status, 201);
    const on = await send('POST', `/api/admin/teachers/${teacher.userId}/enable`, {}, admin);
    assert.equal(on.status, 409);
    assert.equal(db.prepare(`SELECT status FROM users WHERE user_id = ?`).get(teacher.userId).status, 'disabled');
  });

  test('re-enabling a teacher who never set a password puts them back to invited', async () => {
    const { teacher } = await (await invite()).json();
    await send('POST', `/api/admin/teachers/${teacher.userId}/disable`, {}, admin);
    const on = await send('POST', `/api/admin/teachers/${teacher.userId}/enable`, {}, admin);
    assert.equal((await on.json()).status, 'invited');
  });
});
