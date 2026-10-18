import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { openDatabase, migrate } from '../db/index.js';
import { createApp } from '../app.js';
import { testSystemAdminAuth, signInSystemAdmin, TEST_ADMIN } from '../auth/testing.js';

let db;
let server;
let base;
let token;

const auth = () => ({ authorization: `Bearer ${token}` });
const get = (path) => fetch(`${base}${path}`, { headers: auth() });

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth() },
    body: JSON.stringify(body ?? {}),
  });

const REGISTRATION = {
  name: 'Kisumu Day Secondary School',
  county: 'Kisumu',
  adminName: 'Grace Achieng',
  adminEmail: 'G.Achieng@KisumuDay.ac.ke',
  adminPhone: '0712345678',
};

async function register(overrides = {}) {
  const res = await post('/api/schools/register', { ...REGISTRATION, ...overrides });
  return { res, body: await res.json() };
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  server = createApp({ db, logger: false, systemAdminAuth: testSystemAdminAuth() }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = await signInSystemAdmin(base);
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('POST /api/schools/register', () => {
  test('creates a pending school and records who registered it', async () => {
    const { res, body } = await register();
    assert.equal(res.status, 201);
    assert.match(body.schoolId, /^school-[0-9a-f-]{36}$/);
    assert.equal(body.status, 'pending');
    assert.equal(body.name, REGISTRATION.name);

    const row = db.prepare('SELECT * FROM schools WHERE school_id = ?').get(body.schoolId);
    assert.equal(row.admin_email, 'g.achieng@kisumuday.ac.ke');
    assert.equal(row.admin_phone, '0712345678');

    const audit = db.prepare(`SELECT * FROM audit_log WHERE action = 'school.registered'`).get();
    assert.equal(audit.record_id, body.schoolId);
  });

  test('does not hand the admin contact details back to the public status call', async () => {
    const { body } = await register();
    const res = await fetch(`${base}/api/schools/${body.schoolId}`);
    const status = await res.json();
    assert.equal(res.status, 200);
    assert.equal(status.status, 'pending');
    assert.equal(status.adminEmail, undefined);
    assert.equal(status.adminPhone, undefined);
  });

  test('the same admin registering again gets the same school back', async () => {
    const first = await register();
    const again = await register({ name: '  kisumu day secondary school ', adminEmail: 'g.achieng@kisumuday.ac.ke' });
    assert.equal(again.res.status, 200);
    assert.equal(again.body.schoolId, first.body.schoolId);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schools').get().n, 1);
  });

  test('a different admin registering the same school in the same county is a 409', async () => {
    await register();
    const { res, body } = await register({ adminEmail: 'someone.else@example.com' });
    assert.equal(res.status, 409);
    assert.equal(body.status, 'pending');
  });

  test('the same name in another county is a different school', async () => {
    await register();
    const { res } = await register({ county: 'Nakuru', adminEmail: 'other@example.com' });
    assert.equal(res.status, 201);
  });

  test('a rejected school can register again', async () => {
    const first = await register();
    await post(`/api/system-admin/schools/${first.body.schoolId}/reject`, { note: 'Not a registered school' });
    const { res, body } = await register({ adminEmail: 'new.admin@example.com' });
    assert.equal(res.status, 201);
    assert.notEqual(body.schoolId, first.body.schoolId);
  });

  for (const [label, overrides] of [
    ['a missing name', { name: undefined }],
    ['a blank name', { name: '   ' }],
    ['a bad email', { adminEmail: 'not-an-email' }],
    ['a bad phone number', { adminPhone: '12345' }],
    ['an unexpected field', { status: 'active' }],
  ]) {
    test(`400 for ${label}`, async () => {
      const { res } = await register(overrides);
      assert.equal(res.status, 400);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schools').get().n, 0);
    });
  }

  test('accepts an international +254 phone number', async () => {
    const { res } = await register({ adminPhone: '+254712345678' });
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
    ({ body: { schoolId } } = await register());
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
    assert.equal(schools[0].schoolId, pending.schoolId);
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
  beforeEach(async () => {
    ({ body: { schoolId } } = await register());
  });

  const pushClass = () =>
    post('/api/roster/classes', { classGroupId: 'class-1', schoolId, grade: 'Form 1', academicYear: 2026 });

  const seedApprovedRoster = async () => {
    await post(`/api/system-admin/schools/${schoolId}/approve`);
    assert.equal((await pushClass()).status, 200);
    assert.equal(
      (await post('/api/roster/students', { studentId: 'stu-1', classGroupId: 'class-1', fullName: 'Amina Hassan' })).status,
      200
    );
  };

  const syncOne = () =>
    post('/api/sync', {
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

  test('a disabled school cannot change its roster or sync, and can again once enabled', async () => {
    await seedApprovedRoster();
    await post(`/api/system-admin/schools/${schoolId}/disable`);

    assert.equal((await post('/api/roster/students', { studentId: 'stu-2', classGroupId: 'class-1', fullName: 'Brian Kip' })).status, 403);
    const patch = await fetch(`${base}/api/roster/students/stu-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Changed' }),
    });
    assert.equal(patch.status, 403);
    assert.equal((await post('/api/roster/students/stu-1/card', { cardUid: '04AABBCC' })).status, 403);

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
    const res = await post('/api/roster/schools', { schoolId, name: 'My School' });
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT name FROM schools WHERE school_id = ?').get(schoolId).name, REGISTRATION.name);
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
