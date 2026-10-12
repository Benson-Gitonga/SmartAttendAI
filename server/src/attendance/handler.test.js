import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { seed } from '../db/seed.js';
import { todayISO } from '../db/repository.js';
import { randomUUID } from 'node:crypto';
import { createCardHandler, checkScanTime, describeOutcome } from './handler.js';

const CARD = '04A1B2C3'; // stu-form3b-001
const CARD_2 = '04D4E5F6'; // stu-form3b-002

let db;
beforeEach(() => {
  db = openDatabase(':memory:');
  seed(db);
});

const countAttendance = () => db.prepare('SELECT COUNT(*) n FROM attendance_events').get().n;
const rowFor = (studentId) =>
  db.prepare('SELECT * FROM attendance_events WHERE student_id = ?').get(studentId);

describe('createCardHandler - simulated scans write to SQLite', () => {
  test('no challenge: records attendance as capture_method "rfid", unverified', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const result = handle({ cardUid: CARD });

    assert.equal(result.outcome, 'recorded');
    assert.equal(result.challenged, false);
    const row = rowFor('stu-form3b-001');
    assert.equal(row.capture_method, 'rfid');
    assert.equal(row.verified, 0);
    assert.equal(row.status, 'present');
    assert.equal(row.date, todayISO());
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sync_queue WHERE status='pending'").get().n, 1);
  });

  test('challenge + match: capture_method "fingerprint", verified, challenge linked to event', () => {
    const handle = createCardHandler({ db, challengeRate: 1, successRate: 1 });
    const result = handle({ cardUid: CARD });

    assert.equal(result.outcome, 'recorded');
    assert.equal(result.challenged, true);
    const row = rowFor('stu-form3b-001');
    assert.equal(row.capture_method, 'fingerprint');
    assert.equal(row.verified, 1);

    const challenge = db.prepare('SELECT * FROM fingerprint_challenges').get();
    assert.equal(challenge.result, 'match');
    assert.equal(challenge.event_id, row.event_id);
  });

  test('challenge + no match: scan rejected, nothing written to attendance_events', () => {
    const handle = createCardHandler({ db, challengeRate: 1, successRate: 0 });
    const result = handle({ cardUid: CARD });

    assert.equal(result.outcome, 'rejected');
    assert.equal(countAttendance(), 0);

    const challenge = db.prepare('SELECT * FROM fingerprint_challenges').get();
    assert.equal(challenge.result, 'no_match');
    assert.equal(challenge.event_id, null);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='attendance.rejected'").get().n,
      1
    );
  });

  test('second scan of the same student the same day is a duplicate, only one row', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    handle({ cardUid: CARD });
    const again = handle({ cardUid: CARD });

    assert.equal(again.outcome, 'duplicate');
    assert.equal(countAttendance(), 1);
  });

  test('unknown card: no write, audited', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const result = handle({ cardUid: 'DEADBEEF' });

    assert.equal(result.outcome, 'unknown-card');
    assert.equal(countAttendance(), 0);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='rfid.unknown_card'").get().n,
      1
    );
  });

  test('a full sweep of the class writes one record per student', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const cards = db.prepare('SELECT card_uid FROM rfid_cards').all().map((r) => r.card_uid);
    for (const cardUid of cards) handle({ cardUid });
    assert.equal(countAttendance(), 10);
  });

  test('fingerprint challenge fires on roughly 1 in 4 scans', () => {
    const handle = createCardHandler({ db, challengeRate: 0.25, successRate: 1 });
    const n = 600;
    // Every challenged scan logs a fingerprint_challenges row, duplicate or not.
    for (let i = 0; i < n; i++) handle({ cardUid: i % 2 ? CARD : CARD_2 });

    const challenges = db.prepare('SELECT COUNT(*) n FROM fingerprint_challenges').get().n;
    const rate = challenges / n;
    assert.ok(rate > 0.17 && rate < 0.33, `expected ~0.25, got ${rate.toFixed(3)} (${challenges}/${n})`);
  });
});

describe('createCardHandler - gate device reports the fingerprint', () => {
  test('interactive scan picked for a challenge asks for a finger and writes nothing', () => {
    const handle = createCardHandler({ db, challengeRate: 1 });
    const result = handle({ cardUid: CARD, interactive: true });

    assert.equal(result.outcome, 'fingerprint-required');
    assert.equal(result.student.full_name, 'Amina Wanjiru');
    assert.equal(countAttendance(), 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fingerprint_challenges').get().n, 0);
  });

  test('interactive scan not picked for a challenge records straight away', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const result = handle({ cardUid: CARD, interactive: true });

    assert.equal(result.outcome, 'recorded');
    assert.equal(rowFor('stu-form3b-001').capture_method, 'rfid');
  });

  test('device-reported match records a verified fingerprint attendance', () => {
    const handle = createCardHandler({ db, challengeRate: 0, successRate: 0 });
    const result = handle({ cardUid: CARD, interactive: true, fingerprint: 'match' });

    assert.equal(result.outcome, 'recorded');
    assert.equal(result.fingerprint.source, 'device');
    const row = rowFor('stu-form3b-001');
    assert.equal(row.capture_method, 'fingerprint');
    assert.equal(row.verified, 1);
  });

  test('device-reported no_match rejects the scan regardless of successRate', () => {
    const handle = createCardHandler({ db, challengeRate: 0, successRate: 1 });
    const result = handle({ cardUid: CARD, interactive: true, fingerprint: 'no_match' });

    assert.equal(result.outcome, 'rejected');
    assert.equal(countAttendance(), 0);
    assert.equal(db.prepare("SELECT result FROM fingerprint_challenges").get().result, 'no_match');
  });

  test('student already in today is a duplicate before any finger is asked for', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    handle({ cardUid: CARD });
    const again = createCardHandler({ db, challengeRate: 1 })({ cardUid: CARD, interactive: true });

    assert.equal(again.outcome, 'duplicate');
    assert.equal(countAttendance(), 1);
  });

  test('a Wokwi preset card resolves to its demo student', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const result = handle({ cardUid: '01020304' }); // Blue Card

    assert.equal(result.outcome, 'recorded');
    assert.equal(result.student.student_id, 'stu-form3b-006');
  });
});

describe('createCardHandler - scans replayed from a gate device offline queue', () => {
  const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  const offlineScan = (over = {}) => ({
    cardUid: CARD,
    offline: true,
    scanId: randomUUID(),
    scannedAt: hoursAgo(30),
    deviceId: 'gate-main',
    ...over,
  });

  test('is filed under the day it happened, with the scan time and id from the device', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const scan = offlineScan();
    const result = handle(scan);

    assert.equal(result.outcome, 'recorded');
    assert.equal(result.offline, true);
    const row = rowFor('stu-form3b-001');
    assert.equal(row.date, todayISO(new Date(scan.scannedAt)));
    assert.notEqual(row.date, todayISO());
    assert.equal(row.event_id, scan.scanId);
    assert.equal(row.created_at, scan.scannedAt.slice(0, 19).replace('T', ' '));

    const queued = JSON.parse(db.prepare('SELECT payload FROM sync_queue').get().payload);
    assert.equal(queued.createdAt, new Date(scan.scannedAt).toISOString());
    assert.equal(queued.date, row.date);
  });

  test('is never challenged: recorded as an unverified card scan even at challengeRate 1', () => {
    const handle = createCardHandler({ db, challengeRate: 1, successRate: 0 });
    const result = handle(offlineScan({ interactive: true }));

    assert.equal(result.outcome, 'recorded');
    assert.equal(result.challenged, false);
    const row = rowFor('stu-form3b-001');
    assert.equal(row.capture_method, 'rfid');
    assert.equal(row.verified, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fingerprint_challenges').get().n, 0);
  });

  test('a fingerprint sent with an offline scan is ignored', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const result = handle(offlineScan({ fingerprint: 'no_match' }));

    assert.equal(result.outcome, 'recorded');
    assert.equal(rowFor('stu-form3b-001').capture_method, 'rfid');
  });

  test('the same queued scan sent twice is recorded once', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const scan = offlineScan();
    handle(scan);
    const again = handle(scan);

    assert.equal(again.outcome, 'duplicate');
    assert.equal(countAttendance(), 1);
  });

  test('two offline scans of one student on different days are both kept', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    handle(offlineScan({ scannedAt: hoursAgo(50) }));
    handle(offlineScan({ scannedAt: hoursAgo(26) }));
    handle({ cardUid: CARD });

    assert.equal(countAttendance(), 3);
  });

  test('leaves an audit trail with how late it arrived', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const scan = offlineScan({ scannedAt: hoursAgo(2) });
    handle(scan);

    const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'rfid.offline_scan'").get();
    const detail = JSON.parse(audit.detail);
    assert.equal(audit.record_id, 'stu-form3b-001');
    assert.equal(detail.outcome, 'recorded');
    assert.equal(detail.scanId, scan.scanId);
    assert.equal(detail.deviceId, 'gate-main');
    assert.ok(Math.abs(detail.delaySeconds - 7200) < 60, `delaySeconds ${detail.delaySeconds}`);
  });

  test('an unknown card from the queue is audited with its scan time', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const scan = offlineScan({ cardUid: 'C0FFEE99' });
    const result = handle(scan);

    assert.equal(result.outcome, 'unknown-card');
    const detail = JSON.parse(
      db.prepare("SELECT detail FROM audit_log WHERE action = 'rfid.unknown_card'").get().detail
    );
    assert.equal(detail.offline, true);
    assert.equal(detail.scannedAt, scan.scannedAt);
  });
});

describe('checkScanTime', () => {
  const now = new Date('2026-10-12T09:00:00Z');
  const opts = { now, maxAgeDays: 7, skewMs: 5 * 60_000 };

  test('no time given is fine (a live scan)', () => {
    assert.equal(checkScanTime(undefined, opts), null);
  });

  test('a time from earlier in the week is fine', () => {
    assert.equal(checkScanTime('2026-10-09T07:15:00Z', opts), null);
  });

  test('a device clock a little fast is tolerated', () => {
    assert.equal(checkScanTime('2026-10-12T09:03:00Z', opts), null);
  });

  test('a time well in the future is refused', () => {
    assert.match(checkScanTime('2026-10-12T10:00:00Z', opts), /future/);
  });

  test('a time older than the limit is refused', () => {
    assert.match(checkScanTime('2026-10-01T07:00:00Z', opts), /more than 7 days old/);
  });

  test('a device that never set its clock (1970) is refused', () => {
    assert.match(checkScanTime('1970-01-01T00:00:10Z', opts), /days old/);
  });

  test('garbage is refused', () => {
    assert.match(checkScanTime('yesterday-ish', opts), /not a valid time/);
  });
});

describe('describeOutcome', () => {
  test('names the student and how they were recorded', () => {
    const handle = createCardHandler({ db, challengeRate: 1, successRate: 1 });
    const scan = { cardUid: CARD };
    assert.equal(
      describeOutcome(scan, handle(scan)),
      'Amina Wanjiru (stu-form3b-001) -> present via fingerprint (fingerprint verified)'
    );
  });

  test('marks an offline replay with its scan time', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    const scan = { cardUid: CARD, offline: true, scanId: randomUUID(), scannedAt: new Date().toISOString() };
    assert.match(describeOutcome(scan, handle(scan)), /present via rfid \[offline scan from .+\]$/);
  });

  test('reports an unknown card by its UID', () => {
    const handle = createCardHandler({ db, challengeRate: 0 });
    assert.equal(describeOutcome({ cardUid: 'C0FFEE99' }, handle({ cardUid: 'C0FFEE99' })), 'unknown card C0FFEE99, ignored');
  });
});
