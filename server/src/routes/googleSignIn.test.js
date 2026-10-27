import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import {
  createUser, issueSetupCode, lookupSetupCode, issueEmailToken, lookupEmailToken, setTeacherEnabled,
} from '../db/repository.js';
import { createGoogleVerifier } from '../auth/googleAuth.js';
import { hashPassword } from '../auth/systemAdminAuth.js';
import { testUserAuth } from '../auth/testing.js';

let db;
let server;
let base;
const ids = {};

const PASSWORD = 'correct horse battery';
const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const google = (email) => post('/api/auth/google', { credential: `dev:${email}` });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

beforeEach(async () => {
  db = openDatabase(':memory:');
  server = createApp({ db, logger: false, userAuth: testUserAuth(db), google: createGoogleVerifier({ devMode: true }) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  db.prepare(`INSERT INTO schools (school_id, name, status) VALUES ('school-1', 'School One', 'active'), ('school-2', 'School Two', 'pending')`).run();
  ids.admin = createUser(db, { email: 'admin@one.ke', fullName: 'Admin', role: 'admin', schoolId: 'school-1', passwordHash: hashPassword(PASSWORD) }).userId;
  ids.invited = createUser(db, { email: 'invited@one.ke', fullName: 'New Teacher', role: 'teacher', schoolId: 'school-1', status: 'invited' }).userId;
  ids.applicant = createUser(db, { email: 'applicant@two.ke', fullName: 'Applicant', role: 'admin', schoolId: 'school-2', status: 'invited' }).userId;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('GET /api/auth/google', () => {
  test('the page is told which mode Google sign-in is in', async () => {
    const res = await fetch(`${base}/api/auth/google`);
    assert.deepEqual(await res.json(), { mode: 'dev', clientId: null });
  });
});

describe('POST /api/auth/google', () => {
  test('an unlinked Google account cannot sign in, even when its email matches an account', async () => {
    for (const email of ['admin@one.ke', 'invited@one.ke', 'stranger@gmail.com']) {
      const res = await google(email);
      assert.equal(res.status, 403, email);
      assert.equal((await res.json()).reason, 'not_linked');
    }
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE email = 'stranger@gmail.com'`).get().n, 0, 'never makes an account');
    assert.equal(db.prepare(`SELECT status FROM users WHERE user_id = ?`).get(ids.invited).status, 'invited');
  });

  test('401 for a credential Google did not issue', async () => {
    const res = await post('/api/auth/google', { credential: 'forged' });
    assert.equal(res.status, 401);
  });
});

describe('POST /api/auth/google/setup', () => {
  test('an invite code links Google, activates the teacher and is used up', async () => {
    const { code } = issueSetupCode(db, { userId: ids.invited, purpose: 'invite' });
    const res = await post('/api/auth/google/setup', { code, credential: 'dev:new.teacher@gmail.com' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.token);
    assert.equal(body.user.email, 'invited@one.ke');
    assert.equal(body.user.googleEmail, 'new.teacher@gmail.com');
    assert.equal(db.prepare(`SELECT status FROM users WHERE user_id = ?`).get(ids.invited).status, 'active');
    assert.equal(lookupSetupCode(db, code).state, 'used');

    // From now on, that Google account signs in.
    const again = await google('new.teacher@gmail.com');
    assert.equal(again.status, 200);
    assert.equal((await again.json()).user.userId, ids.invited);
  });

  test('a set-up link works too, and other open links stop working', async () => {
    const { token } = issueEmailToken(db, { userId: ids.invited, purpose: 'setup' });
    const { token: reset } = issueEmailToken(db, { userId: ids.invited, purpose: 'reset' });
    const res = await post('/api/auth/google/setup', { token, credential: 'dev:invited@one.ke' });
    assert.equal(res.status, 200);
    assert.equal(lookupEmailToken(db, token).state, 'used');
    assert.equal(lookupEmailToken(db, reset).state, 'revoked');
    assert.ok(db.prepare(`SELECT email_verified_at FROM users WHERE user_id = ?`).get(ids.invited).email_verified_at);
  });

  test('refuses a bad code, a used one, and a school that is not active', async () => {
    assert.equal((await post('/api/auth/google/setup', { code: 'ZZZZ-ZZZZ', credential: 'dev:a@gmail.com' })).status, 404);

    const { code } = issueSetupCode(db, { userId: ids.invited, purpose: 'invite' });
    assert.equal((await post('/api/auth/google/setup', { code, credential: 'dev:a@gmail.com' })).status, 200);
    assert.equal((await post('/api/auth/google/setup', { code, credential: 'dev:b@gmail.com' })).status, 410);

    const { token } = issueEmailToken(db, { userId: ids.applicant, purpose: 'setup' });
    const res = await post('/api/auth/google/setup', { token, credential: 'dev:applicant@gmail.com' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).state, 'school_inactive');
  });

  test('a Google account linked to someone else is refused', async () => {
    const { code } = issueSetupCode(db, { userId: ids.invited, purpose: 'invite' });
    assert.equal((await post('/api/auth/google/setup', { code, credential: 'dev:shared@gmail.com' })).status, 200);

    const other = createUser(db, { email: 'other@one.ke', fullName: 'Other', role: 'teacher', schoolId: 'school-1', status: 'invited' });
    const { code: code2 } = issueSetupCode(db, { userId: other.userId, purpose: 'invite' });
    const res = await post('/api/auth/google/setup', { code: code2, credential: 'dev:shared@gmail.com' });
    assert.equal(res.status, 409);
    assert.equal(lookupSetupCode(db, code2).state, 'ok', 'the code is not used up');
  });

  test('a disabled teacher cannot sign in with Google, and their Google account can be linked again elsewhere', async () => {
    const { code } = issueSetupCode(db, { userId: ids.invited, purpose: 'invite' });
    await post('/api/auth/google/setup', { code, credential: 'dev:moving@gmail.com' });
    setTeacherEnabled(db, ids.invited, false);
    assert.equal((await google('moving@gmail.com')).status, 403);

    const fresh = createUser(db, { email: 'fresh@one.ke', fullName: 'Fresh', role: 'teacher', schoolId: 'school-1', status: 'invited' });
    const { code: code2 } = issueSetupCode(db, { userId: fresh.userId, purpose: 'invite' });
    assert.equal((await post('/api/auth/google/setup', { code: code2, credential: 'dev:moving@gmail.com' })).status, 200);
    assert.equal((await (await google('moving@gmail.com')).json()).user.userId, fresh.userId);
  });

  test('a re-enabled Google-only teacher is active again', async () => {
    const { code } = issueSetupCode(db, { userId: ids.invited, purpose: 'invite' });
    await post('/api/auth/google/setup', { code, credential: 'dev:back@gmail.com' });
    setTeacherEnabled(db, ids.invited, false);
    assert.equal(setTeacherEnabled(db, ids.invited, true).status, 'active');
    assert.equal((await google('back@gmail.com')).status, 200);
  });
});

describe('/api/auth/google/link', () => {
  async function adminToken() {
    const res = await post('/api/auth/login', { email: 'admin@one.ke', password: PASSWORD });
    return (await res.json()).token;
  }

  test('a signed-in user links Google, signs in with it, and unlinks it', async () => {
    const token = await adminToken();
    const linked = await post('/api/auth/google/link', { credential: 'dev:principal@gmail.com' }, bearer(token));
    assert.equal(linked.status, 200);
    assert.equal((await linked.json()).user.googleEmail, 'principal@gmail.com');
    assert.equal((await google('principal@gmail.com')).status, 200);

    const unlinked = await fetch(`${base}/api/auth/google/link`, { method: 'DELETE', headers: bearer(token) });
    assert.equal(unlinked.status, 200);
    assert.equal((await unlinked.json()).user.googleEmail, null);
    assert.equal((await google('principal@gmail.com')).status, 403);
  });

  test('cannot unlink Google when it is the only way in', async () => {
    const { code } = issueSetupCode(db, { userId: ids.invited, purpose: 'invite' });
    const { token } = await (await post('/api/auth/google/setup', { code, credential: 'dev:only@gmail.com' })).json();
    const res = await fetch(`${base}/api/auth/google/link`, { method: 'DELETE', headers: bearer(token) });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).reason, 'no_password');
  });

  test('401 without a sign-in', async () => {
    assert.equal((await post('/api/auth/google/link', { credential: 'dev:x@gmail.com' })).status, 401);
  });
});
