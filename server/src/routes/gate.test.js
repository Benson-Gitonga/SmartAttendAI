import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../db/index.js';
import { seed } from '../db/seed.js';
import { recordAttendance, todayISO } from '../db/repository.js';
import { createApp } from '../app.js';
import { createCardHandler } from '../attendance/handler.js';

let db;
let server;
let base;

const CLASS = 'class-form3b-001';

beforeEach(async () => {
  db = openDatabase(':memory:');
  seed(db);
  server = createApp({ db, logger: false }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // a second class in the same school, to prove the class filter
  db.prepare(`INSERT INTO class_groups (class_group_id, school_id, grade, academic_year)
              VALUES ('class-other', 'school-kibera-001', 'Form 1', 2026)`).run();
  db.prepare(`INSERT INTO students (student_id, class_group_id, admission_no, full_name)
              VALUES ('stu-other-1', 'class-other', 'O/001', 'Other Class Student')`).run();
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

const getClassAttendance = (classId, query = '') =>
  fetch(`${base}/api/gate/classes/${classId}/attendance${query}`);

describe('GET /api/gate/classes/:id/attendance', () => {
  test('404 for a class the server does not know', async () => {
    const res = await getClassAttendance('class-nope');
    assert.equal(res.status, 404);
  });

  test('400 for a malformed date', async () => {
    const res = await getClassAttendance(CLASS, '?date=29-09-2026');
    assert.equal(res.status, 400);
  });

  test('empty day: no records and no gate activity yet', async () => {
    const body = await (await getClassAttendance(CLASS)).json();
    assert.equal(body.classGroupId, CLASS);
    assert.equal(body.date, todayISO());
    assert.deepEqual(body.records, []);
    assert.equal(body.gate.lastScanAt, null);
  });

  test("returns today's gate scans in the PWA's shape, keeping the server eventId", async () => {
    const scan = recordAttendance(db, { studentId: 'stu-form3b-001', captureMethod: 'fingerprint', verified: 1 });

    const body = await (await getClassAttendance(CLASS)).json();
    assert.equal(body.records.length, 1);
    const [r] = body.records;
    assert.equal(r.eventId, scan.eventId);
    assert.equal(r.studentId, 'stu-form3b-001');
    assert.equal(r.status, 'present');
    assert.equal(r.captureMethod, 'fingerprint');
    assert.equal(r.verified, true);
    assert.equal(r.source, 'simulation');
    assert.match(r.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(body.gate.lastScanAt, r.createdAt);
  });

  test('includes teacher marks synced from a phone, with their absence reason', async () => {
    const eventId = randomUUID();
    await fetch(`${base}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        records: [{ eventId, studentId: 'stu-form3b-002', date: todayISO(), status: 'absent', reason: 'fee', createdAt: new Date().toISOString() }],
      }),
    });

    const body = await (await getClassAttendance(CLASS)).json();
    const r = body.records.find((x) => x.eventId === eventId);
    assert.equal(r.status, 'absent');
    assert.equal(r.reason, 'fee');
    assert.equal(r.source, 'client');
    // a teacher mark is not a gate scan
    assert.equal(body.gate.lastScanAt, null);
  });

  test('only returns students in the requested class', async () => {
    recordAttendance(db, { studentId: 'stu-form3b-001', captureMethod: 'rfid' });
    recordAttendance(db, { studentId: 'stu-other-1', captureMethod: 'rfid' });

    const body = await (await getClassAttendance(CLASS)).json();
    assert.deepEqual(body.records.map((r) => r.studentId), ['stu-form3b-001']);
  });

  test('filters by the requested date', async () => {
    recordAttendance(db, { studentId: 'stu-form3b-001', captureMethod: 'rfid', date: '2026-09-01' });
    recordAttendance(db, { studentId: 'stu-form3b-001', captureMethod: 'rfid', date: '2026-09-02' });

    const body = await (await getClassAttendance(CLASS, '?date=2026-09-01')).json();
    assert.equal(body.records.length, 1);
    assert.equal(body.records[0].date, '2026-09-01');
  });
});

describe('POST /api/rfid/scan from a gate device', () => {
  let deviceServer;
  let deviceBase;

  beforeEach(async () => {
    // Every scan challenged, so the two-step flow is deterministic.
    const app = createApp({ db, cardHandler: createCardHandler({ db, challengeRate: 1 }), logger: false });
    deviceServer = app.listen(0);
    await new Promise((r) => deviceServer.once('listening', r));
    deviceBase = `http://127.0.0.1:${deviceServer.address().port}`;
  });

  afterEach(async () => {
    await new Promise((r) => deviceServer.close(r));
  });

  const scan = (body) =>
    fetch(`${deviceBase}/api/rfid/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('tap, asked for a finger, match: shows up at the gate for the class', async () => {
    const first = await scan({ cardUid: '01020304', interactive: true }); // Blue Card
    assert.equal(first.status, 200);
    assert.equal((await first.json()).outcome, 'fingerprint-required');

    const second = await scan({ cardUid: '01020304', interactive: true, fingerprint: 'match' });
    const body = await second.json();
    assert.equal(body.outcome, 'recorded');
    assert.equal(body.student.full_name, 'Jack Otieno');

    const gate = await (await getClassAttendance(CLASS)).json();
    assert.ok(gate.records.some((r) => r.studentId === 'stu-form3b-006'));
  });

  test('lower-case UIDs are accepted', async () => {
    const res = await scan({ cardUid: 'aabbccdd', interactive: true, fingerprint: 'match' });
    assert.equal((await res.json()).student.student_id, 'stu-form3b-009');
  });

  test('unknown card is a 404', async () => {
    const res = await scan({ cardUid: 'C0FFEE99', interactive: true });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).outcome, 'unknown-card');
  });

  test('bad fingerprint value is a 400', async () => {
    const res = await scan({ cardUid: '01020304', fingerprint: 'maybe' });
    assert.equal(res.status, 400);
  });

  test('a UID that is not hex is a 400', async () => {
    const res = await scan({ cardUid: 'NOT-A-CARD' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid scan');
  });

  test('unexpected fields are a 400', async () => {
    const res = await scan({ cardUid: '01020304', studentId: 'stu-form3b-001' });
    assert.equal(res.status, 400);
  });

  test('an offline scan must say when it happened and carry a scanId', async () => {
    assert.equal((await scan({ cardUid: '01020304', offline: true })).status, 400);
    assert.equal((await scan({ cardUid: '01020304', offline: true, scannedAt: new Date().toISOString() })).status, 400);
  });

  test('an offline scan cannot carry a fingerprint result', async () => {
    const res = await scan({
      cardUid: '01020304',
      offline: true,
      scanId: randomUUID(),
      scannedAt: new Date().toISOString(),
      fingerprint: 'match',
    });
    assert.equal(res.status, 400);
  });

  test('a scan time far in the future is a 422', async () => {
    const res = await scan({
      cardUid: '01020304',
      offline: true,
      scanId: randomUUID(),
      scannedAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /future/);
  });

  test("a queued scan from yesterday shows up on yesterday's gate list, not today's", async () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    yesterday.setHours(7, 20, 0, 0);
    const res = await scan({
      cardUid: '11223344', // Green Card -> Kevin Odhiambo
      offline: true,
      scanId: randomUUID(),
      scannedAt: yesterday.toISOString(),
      deviceId: 'gate-main',
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.outcome, 'recorded');
    assert.equal(body.challenged, false); // challengeRate is 1 here, but offline scans skip it

    const then = await (await getClassAttendance(CLASS, `?date=${todayISO(yesterday)}`)).json();
    const kevin = then.records.find((r) => r.studentId === 'stu-form3b-007');
    assert.ok(kevin, "Kevin should be on yesterday's list");
    assert.equal(kevin.captureMethod, 'rfid');
    assert.equal(new Date(kevin.createdAt).getTime(), yesterday.getTime());

    const today = await (await getClassAttendance(CLASS)).json();
    assert.ok(!today.records.some((r) => r.studentId === 'stu-form3b-007'));
  });

  test('replaying the same queued scan is a harmless duplicate', async () => {
    const body = { cardUid: '11223344', offline: true, scanId: randomUUID(), scannedAt: new Date().toISOString() };
    assert.equal((await (await scan(body)).json()).outcome, 'recorded');
    assert.equal((await (await scan(body)).json()).outcome, 'duplicate');
  });
});

describe('POST /api/rfid/scan with a device key set', () => {
  let keyedServer;
  let keyedBase;

  beforeEach(async () => {
    const app = createApp({
      db,
      cardHandler: createCardHandler({ db, challengeRate: 0 }),
      logger: false,
      deviceApiKey: 'gate-secret-123',
    });
    keyedServer = app.listen(0);
    await new Promise((r) => keyedServer.once('listening', r));
    keyedBase = `http://127.0.0.1:${keyedServer.address().port}`;
  });

  afterEach(async () => {
    await new Promise((r) => keyedServer.close(r));
  });

  const post = (headers = {}) =>
    fetch(`${keyedBase}/api/rfid/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ cardUid: '01020304' }),
    });

  test('no key is a 401 and nothing is recorded', async () => {
    const res = await post();
    assert.equal(res.status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_events').get().n, 0);
  });

  test('a wrong key is a 401', async () => {
    assert.equal((await post({ 'x-device-key': 'gate-secret-124' })).status, 401);
    assert.equal((await post({ 'x-device-key': 'short' })).status, 401);
  });

  test('the right key gets through', async () => {
    const res = await post({ 'x-device-key': 'gate-secret-123' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).outcome, 'recorded');
  });

  test('the key only guards the scan endpoint', async () => {
    assert.equal((await fetch(`${keyedBase}/health`)).status, 200);
  });
});

