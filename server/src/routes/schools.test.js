import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { openDatabase, migrate } from '../db/index.js';
import { createApp } from '../app.js';
import { testSystemAdminAuth, signInSystemAdmin, testUserAuth, TEST_ADMIN } from '../auth/testing.js';
import { createMailer } from '../mail/mailer.js';

let db;
let server;
let base;
let token; // the system admin's
let mailer;

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
};

/** The token in the newest emailed link to page (verify-email or set-password). */
function linkToken(page, to = 'g.achieng@kisumuday.ac.ke') {
  const email = mailer.outbox().find((m) => m.to === to && m.link?.includes(`#/${page}/`));
  assert.ok(email, `no ${page} email to ${to}`);
  return email.link.split('/').pop();
}

const confirmEmail = async (to) => post('/api/auth/verify-email', { token: linkToken('verify-email', to) }, {});

/** Apply, with any school or applicant fields changed. The body has the school and the applicant's email. */
async function register(school = {}, applicant = {}) {
  const res = await post('/api/schools/register', {
    school: { ...SCHOOL, ...school },
    applicant: { ...APPLICANT, ...applicant },
  }, {});
  return { res, body: await res.json() };
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  mailer = createMailer({ quiet: true });
  server = createApp({ db, logger: false, systemAdminAuth: testSystemAdminAuth(), userAuth: testUserAuth(db), mailer }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = await signInSystemAdmin(base);
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

describe('POST /api/schools/register', () => {
  test('creates a pending school and an admin account with no password, and signs nobody in', async () => {
    const { res, body } = await register();
    assert.equal(res.status, 201);
    assert.match(body.school.schoolId, /^school-[0-9a-f-]{36}$/);
    assert.equal(body.school.status, 'pending');
    assert.equal(body.email, 'g.achieng@kisumuday.ac.ke');
    assert.equal(body.emailSent, true);
    assert.equal(body.token, undefined, 'the applicant is not signed in');

    const row = db.prepare('SELECT * FROM schools WHERE school_id = ?').get(body.school.schoolId);
    assert.equal(row.school_code, '20414001');
    assert.equal(row.sub_county, 'Kisumu Central');
    assert.equal(row.school_type, 'public');
    assert.equal(row.boarding, 'mixed');
    assert.equal(row.student_estimate, 640);
    assert.equal(row.admin_email, 'g.achieng@kisumuday.ac.ke');

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('g.achieng@kisumuday.ac.ke');
    assert.equal(user.job_title, 'Principal');
    assert.equal(user.role, 'admin');
    assert.equal(user.status, 'invited');
    assert.equal(user.password_hash, null);
    assert.equal(user.email_verified_at, null);
    assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'school.registered' AND record_id = ?`).get(body.school.schoolId));
  });

  test('emails the applicant a link to confirm their address', async () => {
    await register();
    const [email] = mailer.outbox();
    assert.equal(email.to, 'g.achieng@kisumuday.ac.ke');
    assert.match(email.subject, /Confirm your email/);
    assert.match(email.link, /^http:\/\/localhost:5173\/#\/verify-email\/[A-Za-z0-9_-]{43}$/);
    assert.ok(email.text.includes(email.link), 'the link is written out for plain-text mail');
    const stored = db.prepare('SELECT token_hash FROM email_tokens').get();
    assert.ok(!email.link.includes(stored.token_hash), 'only a hash of the token is kept');
  });

  test('the link confirms the email, once', async () => {
    await register();
    const res = await confirmEmail();
    assert.equal(res.status, 200);
    assert.equal((await res.json()).schoolName, SCHOOL.name);
    assert.ok(db.prepare(`SELECT email_verified_at FROM users`).get().email_verified_at);
    assert.equal((await confirmEmail()).status, 410, 'a used link does not work again');
  });

  test('the applicant cannot sign in before the school is approved', async () => {
    await register();
    await confirmEmail();
    const res = await post('/api/auth/login', { email: 'g.achieng@kisumuday.ac.ke', password: 'anything-at-all' }, {});
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'invited');
  });

  test('an older client that sends a password still gets a working account', async () => {
    const { body } = await register({}, { password: 'kisumu-day-2026' });
    assert.doesNotMatch(JSON.stringify(body), /kisumu-day-2026|scrypt/);
    const row = db.prepare('SELECT password_hash, status FROM users').get();
    assert.match(row.password_hash, /^scrypt:/);
    assert.equal(row.status, 'active');
    const res = await post('/api/auth/login', { email: 'g.achieng@kisumuday.ac.ke', password: 'kisumu-day-2026' }, {});
    assert.equal(res.status, 200);
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

  test('a rejected school can apply again with the same email', async () => {
    const first = await register();
    await post(`/api/system-admin/schools/${first.body.school.schoolId}/reject`, { note: 'Missing documents' });
    const { res } = await register();
    assert.equal(res.status, 201);
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
    ['a short password (older clients)', {}, { password: 'short' }],
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
    await confirmEmail();
  });

  const statusOf = () => db.prepare('SELECT status FROM schools WHERE school_id = ?').get(schoolId).status;

  test('approve makes a pending school active and records the reviewer', async () => {
    const res = await post(`/api/system-admin/schools/${schoolId}/approve`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'active');
    assert.equal(body.reviewedBy, TEST_ADMIN.username, 'the reviewer is whoever is signed in');
    assert.ok(body.reviewedAt);
    assert.equal(body.emailSent, true);
    assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'school.approved' AND record_id = ?`).get(schoolId));
  });

  test('an application whose email is not confirmed cannot be approved yet', async () => {
    const other = await register({ name: 'Nyeri High', county: 'Nyeri', schoolCode: '10101010' }, { email: 'p.mwangi@nyerihigh.ac.ke' });
    const res = await post(`/api/system-admin/schools/${other.body.school.schoolId}/approve`);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).reason, 'email_not_verified');

    const { schools } = await (await get('/api/system-admin/schools')).json();
    const byId = Object.fromEntries(schools.map((s) => [s.schoolId, s.adminEmailVerified]));
    assert.deepEqual(byId, { [schoolId]: true, [other.body.school.schoolId]: false });
  });

  test('approval emails a set-up link; the applicant sets a password and is signed in', async () => {
    await post(`/api/system-admin/schools/${schoolId}/approve`);
    const email = mailer.outbox()[0];
    assert.match(email.subject, /is approved/);

    const setupToken = linkToken('set-password');
    const about = await (await fetch(`${base}/api/auth/links/${setupToken}`)).json();
    assert.deepEqual(
      { purpose: about.purpose, email: about.email, schoolName: about.schoolName },
      { purpose: 'setup', email: 'g.achieng@kisumuday.ac.ke', schoolName: SCHOOL.name }
    );

    const res = await post('/api/auth/set-password', { token: setupToken, password: 'a-good-password' }, {});
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.token);
    assert.equal(body.user.role, 'admin');
    assert.equal(body.school.status, 'active');

    const login = await post('/api/auth/login', { email: 'g.achieng@kisumuday.ac.ke', password: 'a-good-password' }, {});
    assert.equal(login.status, 200);
    assert.equal((await post('/api/auth/set-password', { token: setupToken, password: 'another-one!' }, {})).status, 410);
  });

  test('a verify link cannot be used to set a password', async () => {
    const other = await register({ name: 'Nyeri High', county: 'Nyeri', schoolCode: '10101010' }, { email: 'p.mwangi@nyerihigh.ac.ke' });
    assert.equal(other.res.status, 201);
    const res = await post('/api/auth/set-password', { token: linkToken('verify-email', 'p.mwangi@nyerihigh.ac.ke'), password: 'a-good-password' }, {});
    assert.equal(res.status, 400);
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

    const email = mailer.outbox()[0];
    assert.match(email.subject, /Your SmartAttend application/);
    assert.match(email.text, /Reason: Could not verify the school/);
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

  test('enabling a disabled school gives its admin their email back', async () => {
    await post(`/api/system-admin/schools/${schoolId}/approve`);
    await post(`/api/system-admin/schools/${schoolId}/disable`);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE email = 'g.achieng@kisumuday.ac.ke'`).get().n, 0);

    assert.equal((await post(`/api/system-admin/schools/${schoolId}/enable`)).status, 200);
    assert.equal(db.prepare(`SELECT school_id FROM users WHERE email = 'g.achieng@kisumuday.ac.ke'`).get().school_id, schoolId);
  });

  test('a disabled school can apply again, and then the old one cannot be enabled', async () => {
    await post(`/api/system-admin/schools/${schoolId}/approve`);
    await post(`/api/system-admin/schools/${schoolId}/disable`, { note: 'Subscription lapsed' });

    const { res } = await register();
    assert.equal(res.status, 201, 'same name, code and email');

    const on = await post(`/api/system-admin/schools/${schoolId}/enable`);
    assert.equal(on.status, 409);
    assert.equal(statusOf(), 'inactive');
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
    // An older client's application, with a password, so the applicant can
    // sign in while the school is still pending.
    const { body } = await register({}, { password: 'kisumu-day-2026' });
    schoolId = body.school.schoolId;
    const login = await (await post('/api/auth/login', { email: APPLICANT.email, password: 'kisumu-day-2026' }, {})).json();
    staff = { authorization: `Bearer ${login.token}` };
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

describe('forgot password', () => {
  const forgot = (email) => post('/api/auth/forgot-password', { email }, {});
  const GENERIC = /If that email has a SmartAttend account/;

  test('the same answer for an unknown email, and nothing is sent', async () => {
    const res = await forgot('nobody@example.com');
    assert.equal(res.status, 200);
    assert.match((await res.json()).message, GENERIC);
    assert.equal(mailer.outbox().length, 0);
  });

  test('a signed-up admin gets a reset link that replaces the password', async () => {
    await register({}, { password: 'kisumu-day-2026' });
    const res = await forgot('G.Achieng@kisumuday.ac.ke');
    assert.match((await res.json()).message, GENERIC);
    assert.match(mailer.outbox()[0].subject, /Reset your SmartAttend password/);

    const about = await (await fetch(`${base}/api/auth/links/${linkToken('set-password')}`)).json();
    assert.equal(about.purpose, 'reset');

    // The school must be live to set a password, as with any sign-in.
    const schoolId = db.prepare('SELECT school_id FROM schools').get().school_id;
    db.prepare(`UPDATE schools SET status = 'active' WHERE school_id = ?`).run(schoolId);
    const set = await post('/api/auth/set-password', { token: linkToken('set-password'), password: 'brand-new-pass' }, {});
    assert.equal(set.status, 200);

    const login = (password) => post('/api/auth/login', { email: APPLICANT.email, password }, {});
    assert.equal((await login('kisumu-day-2026')).status, 401);
    assert.equal((await login('brand-new-pass')).status, 200);
  });

  test('an applicant who lost the confirmation email gets it again', async () => {
    await register();
    await forgot(APPLICANT.email);
    const emails = mailer.outbox().filter((m) => m.link?.includes('#/verify-email/'));
    assert.equal(emails.length, 2);
    assert.equal((await post('/api/auth/verify-email', { token: emails[1].link.split('/').pop() }, {})).status, 410, 'the older link stops working');
    assert.equal((await confirmEmail()).status, 200);
  });

  test('a confirmed applicant waiting for review gets nothing new', async () => {
    await register();
    await confirmEmail();
    const before = mailer.outbox().length;
    await forgot(APPLICANT.email);
    assert.equal(mailer.outbox().length, before);
  });

  test('too many requests for one email are refused for a while', async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await forgot('nobody@example.com')).status, 200);
    assert.equal((await forgot('nobody@example.com')).status, 429);
  });

  test('a junk link is a 404', async () => {
    const res = await fetch(`${base}/api/auth/links/${'x'.repeat(43)}`);
    assert.equal(res.status, 404);
  });
});
