import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { createUser, issueSetupCode, lookupSetupCode } from '../db/repository.js';
import { createGoogleVerifier } from '../auth/googleAuth.js';
import { testUserAuth } from '../auth/testing.js';

let db;
let server;
let base;

const google = (email) =>
  fetch(`${base}/api/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: `dev:${email}` }),
  });

beforeEach(async () => {
  db = openDatabase(':memory:');
  server = createApp({ db, logger: false, userAuth: testUserAuth(db), google: createGoogleVerifier({ devMode: true }) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  db.prepare(`INSERT INTO schools (school_id, name, status) VALUES ('school-1', 'School One', 'active'), ('school-2', 'School Two', 'pending')`).run();
  createUser(db, { email: 'admin@one.ke', fullName: 'Admin', role: 'admin', schoolId: 'school-1', passwordHash: 'x' });
  createUser(db, { email: 'invited@one.ke', fullName: 'New Teacher', role: 'teacher', schoolId: 'school-1', status: 'invited' });
  createUser(db, { email: 'gone@one.ke', fullName: 'Gone', role: 'teacher', schoolId: 'school-1', passwordHash: 'x', status: 'disabled' });
  createUser(db, { email: 'applicant@two.ke', fullName: 'Applicant', role: 'admin', schoolId: 'school-2', status: 'invited' });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('POST /api/auth/google', () => {
  test('the page is told which mode Google sign-in is in', async () => {
    const res = await fetch(`${base}/api/auth/google`);
    assert.deepEqual(await res.json(), { mode: 'dev', clientId: null });
  });

  test('signs in an existing account and returns a token that works', async () => {
    const res = await google('ADMIN@one.ke');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.user.email, 'admin@one.ke');
    assert.equal(body.school.name, 'School One');
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${body.token}` } });
    assert.equal(me.status, 200);
  });

  test('sets up an invited teacher, and their invite code stops working', async () => {
    const userId = db.prepare(`SELECT user_id FROM users WHERE email = 'invited@one.ke'`).get().user_id;
    const { code } = issueSetupCode(db, { userId, purpose: 'invite' });

    const res = await google('invited@one.ke');
    assert.equal(res.status, 200);
    const row = db.prepare(`SELECT status, email_verified_at FROM users WHERE user_id = ?`).get(userId);
    assert.equal(row.status, 'active');
    assert.ok(row.email_verified_at);
    assert.equal(lookupSetupCode(db, code).state, 'revoked');
  });

  test('refuses an email with no account, a disabled one, and a school still waiting for approval', async () => {
    for (const [email, reason] of [['stranger@gmail.com', 'no_account'], ['gone@one.ke', 'disabled'], ['applicant@two.ke', 'school_inactive']]) {
      const res = await google(email);
      assert.equal(res.status, 403, email);
      assert.equal((await res.json()).reason, reason);
    }
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE email = 'stranger@gmail.com'`).get().n, 0, 'never makes an account');
  });

  test('401 for a credential Google did not issue', async () => {
    const res = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: 'forged' }),
    });
    assert.equal(res.status, 401);
  });
});

describe('POST /api/auth/refresh', () => {
  test('a signed-in device gets a new token', async () => {
    const { token } = await (await google('admin@one.ke')).json();
    const res = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.token);
    assert.equal(body.user.email, 'admin@one.ke');
  });

  test('401 without one', async () => {
    assert.equal((await fetch(`${base}/api/auth/refresh`, { method: 'POST' })).status, 401);
  });
});
