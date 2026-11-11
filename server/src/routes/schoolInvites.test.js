import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { testSystemAdminAuth, signInSystemAdmin, testUserAuth, TEST_ADMIN } from '../auth/testing.js';
import { normalizeCode } from '../auth/setupCodes.js';

let db;
let server;
let base;
let token;

const send = (method, path, body, headers = {}) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
const asSysAdmin = (method, path, body) => send(method, path, body, { authorization: `Bearer ${token}` });

const newInvite = async (body = {}) => (await asSysAdmin('POST', '/api/system-admin/school-invites', body)).json();

const registration = (code, overrides = {}) => ({
  code,
  school: { name: 'Benson Secondary School', county: 'Nairobi', ...overrides.school },
  applicant: { fullName: 'Jane Wanjiku', email: 'jane@benson.ac.ke', password: 'long-enough-1', ...overrides.applicant },
});

beforeEach(async () => {
  db = openDatabase(':memory:');
  server = createApp({ db, logger: false, systemAdminAuth: testSystemAdminAuth(), userAuth: testUserAuth(db) }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = await signInSystemAdmin(base);
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('system admin creates school invite codes', () => {
  test('returns the code once and keeps only its hash', async () => {
    const res = await asSysAdmin('POST', '/api/system-admin/school-invites', { schoolName: 'Benson Secondary School', note: 'for Jane' });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.match(body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(Date.parse(body.expiresAt) > Date.now() + 6 * 86_400_000, 'lasts about a week');
    const row = db.prepare('SELECT * FROM school_invites').get();
    assert.notEqual(row.code_hash, normalizeCode(body.code));
    assert.equal(row.created_by, TEST_ADMIN.username);

    const { invites } = await (await asSysAdmin('GET', '/api/system-admin/school-invites')).json();
    assert.equal(invites.length, 1);
    assert.equal(invites[0].state, 'ok');
    assert.equal(invites[0].code, undefined, 'the code is never listed');
  });

  test('needs the system admin', async () => {
    const res = await send('POST', '/api/system-admin/school-invites', {});
    assert.equal(res.status, 401);
  });

  test('refuses an email that already has an account', async () => {
    await send('POST', '/api/auth/register-school', registration((await newInvite()).code));
    const res = await asSysAdmin('POST', '/api/system-admin/school-invites', { email: 'jane@benson.ac.ke' });
    assert.equal(res.status, 409);
  });
});

describe('registering a school with an invite code', () => {
  test('the code is recognised as a school invite', async () => {
    const { code } = await newInvite({ schoolName: 'Benson Secondary School', email: 'jane@benson.ac.ke' });
    const res = await fetch(`${base}/api/auth/setup-codes/${code.toLowerCase().replace('-', ' ')}`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.kind, 'school');
    assert.equal(body.schoolName, 'Benson Secondary School');
    assert.equal(body.email, 'jane@benson.ac.ke');
  });

  test('creates an approved school and an active admin who is signed straight in', async () => {
    const { code } = await newInvite();
    const res = await send('POST', '/api/auth/register-school', registration(code));
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.ok(body.token, 'signed in');

    const school = db.prepare(`SELECT * FROM schools WHERE name = 'Benson Secondary School'`).get();
    assert.equal(school.status, 'active');
    assert.equal(school.reviewed_by, TEST_ADMIN.username);
    const user = db.prepare(`SELECT * FROM users WHERE email = 'jane@benson.ac.ke'`).get();
    assert.equal(user.role, 'admin');
    assert.equal(user.status, 'active');
    assert.equal(user.school_id, school.school_id);

    // The token works for the new school's admin endpoints, e.g. inviting a teacher.
    const teacher = await send('POST', `/api/admin/schools/${school.school_id}/teachers`,
      { fullName: 'Mr. Otieno', email: 'otieno@benson.ac.ke' }, { authorization: `Bearer ${body.token}` });
    assert.equal(teacher.status, 201);

    const { invites } = await (await asSysAdmin('GET', '/api/system-admin/school-invites')).json();
    assert.equal(invites[0].state, 'used');
    assert.equal(invites[0].registeredSchoolName, 'Benson Secondary School');
  });

  test('works only once', async () => {
    const { code } = await newInvite();
    await send('POST', '/api/auth/register-school', registration(code));
    const again = await send('POST', '/api/auth/register-school', registration(code, {
      school: { name: 'Another School' }, applicant: { email: 'other@school.ac.ke' },
    }));
    assert.equal(again.status, 410);
    assert.equal((await again.json()).state, 'used');
    const lookup = await fetch(`${base}/api/auth/setup-codes/${code}`);
    assert.equal(lookup.status, 410);
  });

  test('an invite for one email cannot be used with another', async () => {
    const { code } = await newInvite({ email: 'jane@benson.ac.ke' });
    const res = await send('POST', '/api/auth/register-school', registration(code, { applicant: { email: 'someone@else.ac.ke' } }));
    assert.equal(res.status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schools').get().n, 0, 'nothing was created');
    assert.equal(db.prepare('SELECT used_at FROM school_invites').get().used_at, null, 'the code still works');
  });

  test('a matching email counts as confirmed', async () => {
    const { code } = await newInvite({ email: 'Jane@Benson.ac.ke' });
    await send('POST', '/api/auth/register-school', registration(code));
    assert.ok(db.prepare(`SELECT email_verified_at FROM users WHERE email = 'jane@benson.ac.ke'`).get().email_verified_at);
  });

  test('a cancelled invite no longer works', async () => {
    const { id, code } = await newInvite();
    const revoked = await asSysAdmin('POST', `/api/system-admin/school-invites/${id}/revoke`);
    assert.equal((await revoked.json()).state, 'revoked');
    const res = await send('POST', '/api/auth/register-school', registration(code));
    assert.equal(res.status, 410);
  });

  test('a wrong code is a 404 and the password is required', async () => {
    const wrong = await send('POST', '/api/auth/register-school', registration('ABCD-EFGH'));
    assert.equal(wrong.status, 404);
    const { code } = await newInvite();
    const noPassword = registration(code);
    delete noPassword.applicant.password;
    assert.equal((await send('POST', '/api/auth/register-school', noPassword)).status, 400);
  });

  test('a school that is already registered is a conflict', async () => {
    await send('POST', '/api/auth/register-school', registration((await newInvite()).code));
    const { code } = await newInvite();
    const res = await send('POST', '/api/auth/register-school', registration(code, { applicant: { email: 'other@benson.ac.ke' } }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).field, 'school_name');
  });

  test('teacher codes still look up as staff', async () => {
    const { code } = await newInvite();
    const reg = await (await send('POST', '/api/auth/register-school', registration(code))).json();
    const school = db.prepare('SELECT school_id FROM schools').get();
    const teacher = await (await send('POST', `/api/admin/schools/${school.school_id}/teachers`,
      { fullName: 'Mr. Otieno', email: 'otieno@benson.ac.ke' }, { authorization: `Bearer ${reg.token}` })).json();
    const lookup = await (await fetch(`${base}/api/auth/setup-codes/${teacher.code}`)).json();
    assert.equal(lookup.kind, 'staff');
    assert.equal(lookup.schoolName, 'Benson Secondary School');
  });
});
