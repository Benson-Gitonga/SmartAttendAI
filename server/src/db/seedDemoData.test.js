import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './index.js';
import { seed } from './seed.js';
import { seedDemoData, demoSchoolDays, isSchoolDay } from './seedDemoData.js';
import { getFlaggedStudents } from './repository.js';

const TODAY = new Date(2026, 9, 21); // a Wednesday in Term 3

test('school days follow the term calendar and skip holidays', () => {
  assert.equal(isSchoolDay('2026-10-20'), false, 'Mashujaa Day');
  assert.equal(isSchoolDay('2026-08-17'), false, 'August holiday');
  assert.equal(isSchoolDay('2026-10-17'), false, 'Saturday');
  assert.equal(isSchoolDay('2026-10-19'), true);
  const days = demoSchoolDays(TODAY);
  assert.ok(days[0] >= '2026-07-21' && days.at(-1) === '2026-10-19', 'about three months back, up to yesterday');
});

test('fills three months for the demo school, flags some students, and is safe to re-run', () => {
  const db = openDatabase(':memory:');
  seed(db);
  // A register someone really took is kept.
  db.prepare(`INSERT INTO attendance_events (event_id, student_id, date, status, capture_method, source)
              VALUES ('real-1', 'stu-form3b-001', '2026-10-19', 'absent', 'manual', 'client')`).run();

  const first = seedDemoData(db, TODAY);
  assert.ok(first.records > 1500);
  assert.equal(seedDemoData(db, TODAY).records, 0);

  assert.equal(db.prepare(`SELECT status FROM attendance_events WHERE student_id = 'stu-form3b-001' AND date = '2026-10-19'`).get().status, 'absent');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sync_queue`).get().n, 0, 'demo rows never go to the cloud');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM class_groups WHERE school_id = 'school-kibera-001'`).get().n, 4);

  db.close();
});

test('the flagged list has red and amber students', () => {
  const db = openDatabase(':memory:');
  seed(db);
  seedDemoData(db); // relative to today, as the server does
  const flags = getFlaggedStudents(db, 'school-kibera-001').map((f) => f.flag);
  assert.ok(flags.includes('red') && flags.includes('amber'), flags.join(','));
  db.close();
});
