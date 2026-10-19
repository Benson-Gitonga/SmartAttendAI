import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { openDatabase, migrate } from '../db/index.js';
import { createApp } from '../app.js';
import { testSystemAdminAuth, signInSystemAdmin, testUserAuth, TEST_ADMIN } from '../auth/testing.js';

let db;
let server;
let base;
let token; // the system admin's

const auth = () => ({ authorization: `Bearer ${token}` });
const get = (path) => fetch(`${base}${path}`, { headers: auth() });

const post = (path, body, headers = auth()) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });

const SCHOOL = {
  name: 'Kisumu Day Secondary School',
  county: 'Kisumu',
  subCounty: 'Kisumu Central',
  schoolCode: '20414001',
  schoolType: 'public',
  boarding: 'mixed',
  studentEstimate: 640,
};
const APPLICANT = {
  fullName: 'Grace Achieng',
  email: 'G.Achieng@KisumuDay.ac.ke',
  phone: '0712345678',
  jobTitle: 'Principal',
  password: 'kisumu-day-2026',
};

/** Apply, with any school or applicant fields changed. The body has the new token, user and school. */
async function register(school = {}, applicant = {}) {
  const res = await post('/api/schools/register', {
    school: { ...SCHOOL, ...school },
    applicant: { ...APPLICANT, ...applicant },
  }, {});
  return { res, body: await res.json() };
}

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

describe('POST /api/schools/register', () => {
  test('creates a pending school and an admin account, and signs the applicant in', async () => {
    const { res, body } = await register();
    assert.equal(res.status, 201);
    assert.match(body.school.schoolId, /^school-[0-9a-f-]{36}$/);
    assert.equal(body.school.status, 'pending');
    assert.equal(body.user.role, 'admin');
    assert.equal(body.user.email, 'g.achieng@kisumuday.ac.ke');
    assert.equal(body.user.schoolId, body.school.schoolId);
    assert.ok(body.token);

    const row = db.prepare('SELECT * FROM schools WHERE school_id = ?').get(body.school.schoolId);
    assert.equal(row.school_code, '20414001');
    assert.equal(row.sub_county, 'Kisumu Central');
    assert.equal(row.school_type, 'public');
    assert.equal(row.boarding, 'mixed');
    assert.equal(row.student_estimate, 640);
    assert.equal(row.admin_email, 'g.achieng@kisumuday.ac.ke');

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('g.achieng@kisumuday.ac.ke');
    assert.equal(user.job_title, 'Principal');
    assert.match(user.password_hash, /^scrypt:/);
    assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'school.registered' AND record_id = ?`).get(body.school.schoolId));
  });

  test('never stores or returns the password', async () => {
    const { body } = await register();
    assert.doesNotMatch(JSON.stringify(body), /kisumu-day-2026|scrypt/);
    const row = db.prepare('SELECT password_hash FROM users').get();
    assert.doesNotMatch(row.password_hash, /kisumu-day-2026/);
  });

  test('the applicant can sign in with the password they chose', async () => {
    await register();
    const res = await post('/api/auth/login', { email: 'g.achieng@kisumuday.ac.ke', password: APPLICANT.password }, {});
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.school.status, 'pending');
  });

  test('the public status call does not hand out contact details', async () => {
    const { body } = await register();
    const res = await fetch(`${base}/api/schools/${body.school.schoolId}`);
    const status = await res.json();
    assert.equal(res.status, 200);
    assert.equal(status.status, 'pending');
    assert.equal(status.adminEmail, undefined);
    assert.equal(status.adminPhone, undefined);
  });

  test('409 for an email that already has an account', async () => {
    await register();
    const { res, body } = await register({ name: 'Another School', schoolCode: '99999999' }, { email: 'g.achieng@kisumuday.ac.ke' });
    assert.equal(res.status, 409);
    assert.equal(body.field, 'email');
  });

  test('409 for a school code that is already registered', async () => {
    await register();
    const { res, body } = await register({ name: 'Renamed School' }, { email: 'other@example.com' });
    assert.equal(res.status, 409);
    assert.equal(body.field, 'school_code');
  });

  test('409 for the same name in the same county', async () => {
    await register();
    const { res, body } = await register({ name: ' kisumu day secondary school ', schoolCode: undefined }, { email: 'other@example.com' });
    assert.equal(res.status, 409);
    assert.equal(body.field, 'school_name');
  });

  test('the same name in another county is a different school', async () => {
    await register();
    const { res } = await register({ county: 'Nakuru', schoolCode: '30000001' }, { email: 'other@example.com' });
    assert.equal(res.status, 201);
  });

  test('a rejected school can apply again, code and all', async () => {
    const first = await register();
    await post(`/api/system-admin/schools/${first.body.school.schoolId}/reject`, { note: 'Not a registered school' });
    const { res, body } = await register({}, { email: 'new.admin@example.com' });
    assert.equal(res.status, 201);
    assert.notEqual(body.school.schoolId, first.body.school.schoolId);
  });

  test('a failed application leaves nothing behind', async () => {
    await register();
    await register({ name: 'Renamed School' }, { email: 'other@example.com' }); // 409 on the code
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schools').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  });

  for (const [label, school, applicant] of [
    ['a missing school name', { name: undefined }, {}],
    ['a missing county', { county: undefined }, {}],
    ['a blank school name', { name: '   ' }, {}],
    ['a school code with spaces', { schoolCode: '204 140' }, {}],
    ['an unknown school type', { schoolType: 'charter' }, {}],
    ['a student estimate of zero', { studentEstimate: 0 }, {}],
    ['a bad email', {}, { email: 'not-an-email' }],
    ['a bad phone number', {}, { phone: '12345' }],
    ['a short password', {}, { password: 'short' }],
    ['a missing password', {}, { password: undefined }],
    ['an unexpected field', { status: 'active' }, {}],
  ]) {
    test(`400 for ${label}`, async () => {
      const { res } = await register(school, applicant);
      assert.equal(res.status, 400);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schools').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    });
  }

  test('only the name and county are required for the school', async () => {
    const { res } = await register(
      { subCounty: undefined, schoolCode: undefined, schoolType: undefined, boarding: undefined, studentEstimate: undefined },
      { phone: undefined, jobTitle: undefined }
    );
    assert.equal(res.status, 201);
  });

  test('accepts an international +254 phone number', async () => {
    const { res } = await register({}, { phone: '+254712345678' });
    assert.equal(res.status, 201);
  });

  test('404 for the status of an unknown school', async () => {
    const res = await fetch(`${base}/api/schools/school-nope`);
    assert.equal(res.status, 404);
  });
});

describe('approval flow', () => {
  let schoolId;
  beforeEach(async () => {
    ({ body: { school: { schoolId } } } = await register());
  });

  const statusOf = () => db.prepare('SELECT status FROM schools WHERE school_id = ?').get(schoolId).status;

  test('approve makes a pending school active and records the reviewer', async () => {
    const res = await post(`/api/system-admin/schools/${schoolId}/approve`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'active');
    assert.equal(body.reviewedBy, TEST_ADMIN.username, 'the reviewer is whoever is signed in');
    assert.ok(body.reviewedAt);
    assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'school.approved' AND record_id = ?`).get(schoolId));
  });

  test('reject needs a reason, and the school admin can read it', async () => {
    const noReason = await post(`/api/system-admin/schools/${schoolId}/reject`, {});
    assert.equal(noReason.status, 400);
    assert.equal(statusOf(), 'pending');

    const res = await post(`/api/system-admin/schools/${schoolId}/reject`, { note: 'Could not verify the school' });
    assert.equal(res.status, 200);
    assert.equal(statusOf(), 'rejected');

    const status = await (await fetch(`${base}/api/schools/${schoolId}`)).json();
    assert.equal(status.reviewNote, 'Could not verify the school');
  });

  test('disable and enable an approved school', async () => {
    await post(`/api/system-admin/schools/${schoolId}/approve`);

    const off = await post(`/api/system-admin/schools/${schoolId}/disable`, { note: 'Subscription lapsed' });
    assert.equal(off.status, 200);
    assert.equal(statusOf(), 'inactive');

    const on = await post(`/api/system-admin/schools/${schoolId}/enable`);
    assert.equal(on.status, 200);
    assert.equal(statusOf(), 'active');

    const actions = db.prepare(`SELECT action FROM audit_log WHERE record_id = ? ORDER BY id`).all(schoolId).map((r) => r.action);
    assert.deepEqual(actions, ['school.registered', 'school.approved', 'school.disabled', 'school.enabled']);
  });

  for (const [label, action] of [
    ['enable a pending school (that would skip approval)', 'enable'],
    ['disable a pending school', 'disable'],
  ]) {
    test(`409 to ${label}`, async () => {
      const res = await post(`/api/system-admin/schools/${schoolId}/${action}`);
      assert.equal(res.status, 409);
      assert.equal(statusOf(), 'pending');
    });
  }

  test('409 to approve a school twice, or approve a disabled one', async () => {
    await post(`/api/system-admin/schools/${schoolId}/approve`);
    assert.equal((await post(`/api/system-admin/schools/${schoolId}/approve`)).status, 409);

    await post(`/api/system-admin/schools/${schoolId}/disable`);
    assert.equal((await post(`/api/system-admin/schools/${schoolId}/approve`)).status, 409);
    assert.equal(statusOf(), 'inactive');
  });

  test('409 for any change to a rejected school', async () => {
    await post(`/api/system-admin/schools/${schoolId}/reject`, { note: 'Duplicate' });
    for (const action of ['approve', 'enable', 'disable']) {
      assert.equal((await post(`/api/system-admin/schools/${schoolId}/${action}`)).status, 409, action);
    }
  });

  test('the old status toggle cannot activate a pending school either', async () => {
    const res = await post(`/api/system-admin/schools/${schoolId}/status`, { status: 'active' });
    assert.equal(res.status, 409);
    assert.equal(statusOf(), 'pending');
  });

  test('404 for an unknown school', async () => {
    assert.equal((await post('/api/system-admin/schools/school-nope/approve')).status, 404);
  });

  test('the request cannot claim to be a different reviewer', async () => {
    const res = await post(`/api/system-admin/schools/${schoolId}/approve`, { actor: 'someone-else' });
    assert.equal(res.status, 400);
    assert.equal(statusOf(), 'pending');
  });

  test('400 for an overlong note', async () => {
    const res = await post(`/api/system-admin/schools/${schoolId}/reject`, { note: 'x'.repeat(501) });
    assert.equal(res.status, 400);
  });
});

describe('GET /api/system-admin/schools', () => {
  test('puts waiting schools first and counts each status', async () => {
    db.prepare(`INSERT INTO schools (school_id, name, county) VALUES ('school-a', 'Alliance High', 'Kiambu')`).run();
    const { body: pending } = await register();

    const res = await get(`/api/system-admin/schools`);
    const { schools, counts } = await res.json();
    assert.equal(schools[0].schoolId, pending.school.schoolId);
    assert.equal(schools[0].schoolCode, '20414001');
    assert.equal(schools[0].studentEstimate, 640);
    assert.equal(schools[0].adminName, 'Grace Achieng');
    assert.deepEqual(counts, { pending: 1, active: 1, inactive: 0, rejected: 0 });
  });

  test('filters by status', async () => {
    db.prepare(`INSERT INTO schools (school_id, name, county) VALUES ('school-a', 'Alliance High', 'Kiambu')`).run();
    await register();
    const { schools } = await (await get(`/api/system-admin/schools?status=pending`)).json();
    assert.equal(schools.length, 1);
    assert.equal(schools[0].status, 'pending');
  });

  test('400 for an unknown status filter', async () => {
    assert.equal((await get(`/api/system-admin/schools?status=deleted`)).status, 400);
  });
});

describe('a school that is not active cannot write', () => {
  let schoolId;
  let staff; // the applicant's own sign-in
  beforeEach(async () => {
    const { body } = await register();
    schoolId = body.school.schoolId;
    staff = { authorization: `Bearer ${body.token}` };
  });

  const asStaff = (path, body, method = 'POST') =>
    fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...staff }, body: JSON.stringify(body) });
  const pushClass = () => asStaff('/api/roster/classes', { classGroupId: 'class-1', schoolId, grade: 'Form 1', academicYear: 2026 });

  const seedApprovedRoster = async () => {
    await post(`/api/system-admin/schools/${schoolId}/approve`);
    assert.equal((await pushClass()).status, 200);
    assert.equal((await asStaff('/api/roster/students', { studentId: 'stu-1', classGroupId: 'class-1', fullName: 'Amina Hassan' })).status, 200);
  };

  const syncOne = () =>
    asStaff('/api/sync', {
      deviceId: 'phone-1',
      records: [{
        eventId: randomUUID(), studentId: 'stu-1', date: '2026-10-19', status: 'present',
        captureMethod: 'manual', createdAt: new Date().toISOString(),
      }],
    });

  test('a pending school cannot push classes', async () => {
    const res = await pushClass();
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.status, 'pending');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class_groups').get().n, 0);
  });

  test('a pending school admin cannot read the school dashboard yet', async () => {
    const res = await fetch(`${base}/api/admin/schools/${schoolId}/overview`, { headers: staff });
    assert.equal(res.status, 403);
  });

  test('a disabled school cannot change its roster or sync, and can again once enabled', async () => {
    await seedApprovedRoster();
    await post(`/api/system-admin/schools/${schoolId}/disable`);

    assert.equal((await asStaff('/api/roster/students', { studentId: 'stu-2', classGroupId: 'class-1', fullName: 'Brian Kip' })).status, 403);
    assert.equal((await asStaff('/api/roster/students/stu-1', { fullName: 'Changed' }, 'PATCH')).status, 403);
    assert.equal((await asStaff('/api/roster/students/stu-1/card', { cardUid: '04AABBCC' })).status, 403);

    const blocked = await syncOne();
    assert.equal(blocked.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_events').get().n, 0);

    await post(`/api/system-admin/schools/${schoolId}/enable`);
    const ok = await syncOne();
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).insertedCount, 1);
  });

  test('a roster push cannot rename a registered school', async () => {
    await post(`/api/system-admin/schools/${schoolId}/approve`);
    const res = await asStaff('/api/roster/schools', { schoolId, name: 'My School' });
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT name FROM schools WHERE school_id = ?').get(schoolId).name, SCHOOL.name);
  });
});

describe('migrating a database from before school approval', () => {
  test('keeps every school and class, and accepts the new statuses', () => {
    const old = new Database(':memory:');
    old.pragma('foreign_keys = ON');
    old.exec(`
      CREATE TABLE schools (
        school_id TEXT PRIMARY KEY, name TEXT NOT NULL, county TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE class_groups (
        class_group_id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
        grade TEXT NOT NULL, stream TEXT, academic_year INTEGER NOT NULL, teacher_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE students (
        student_id TEXT PRIMARY KEY, class_group_id TEXT NOT NULL, admission_no TEXT NOT NULL,
        full_name TEXT NOT NULL, guardian_phone TEXT, guardian_email TEXT
      );
      CREATE TABLE attendance_events (id INTEGER PRIMARY KEY, reason TEXT);
      INSERT INTO schools (school_id, name, county, status) VALUES ('s1', 'Old School', 'Nairobi', 'inactive');
      INSERT INTO class_groups (class_group_id, school_id, grade, academic_year) VALUES ('c1', 's1', 'Form 2', 2026);
    `);

    migrate(old);
    migrate(old); // safe to run twice

    assert.deepEqual(
      old.prepare('SELECT school_id, name, status FROM schools').get(),
      { school_id: 's1', name: 'Old School', status: 'inactive' }
    );
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM class_groups').get().n, 1, 'the class survived the rebuild');
    assert.equal(old.pragma('foreign_keys', { simple: true }), 1, 'foreign keys are back on');

    old.prepare(`INSERT INTO schools (school_id, name, status) VALUES ('s2', 'New School', 'pending')`).run();
    assert.throws(() => old.prepare(`INSERT INTO class_groups (class_group_id, school_id, grade, academic_year) VALUES ('c2', 'nope', 'F1', 2026)`).run());
    old.close();
  });
});
