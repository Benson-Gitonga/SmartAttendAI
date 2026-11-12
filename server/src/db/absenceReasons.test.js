// Absence reasons reach the server's risk score and the school overview.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './index.js';
import { getFlaggedStudents, getSchoolOverview, todayISO } from './repository.js';
import { absenceReasonSummary, assessStudent, REASON_COVERAGE_MIN } from '../lib/riskModel.js';

let db;

/** The last `count` weekdays before today, oldest first. */
function recentWeekdays(count) {
  const out = [];
  const d = new Date();
  while (out.length < count) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() >= 1 && d.getDay() <= 5) out.unshift(todayISO(d));
  }
  return out;
}

const insert = (studentId, date, status, reason = null) =>
  db.prepare(
    `INSERT INTO attendance_events (event_id, student_id, date, status, capture_method, source, reason)
     VALUES (?, ?, ?, ?, 'manual', 'client', ?)`
  ).run(`${studentId}-${date}`, studentId, date, status, reason);

beforeEach(() => {
  db = openDatabase(':memory:');
  db.prepare(`INSERT INTO schools (school_id, name, county) VALUES ('s1', 'School', 'Nairobi')`).run();
  db.prepare(`INSERT INTO class_groups (class_group_id, school_id, grade, academic_year) VALUES ('c1', 's1', 'Form 1', 2026)`).run();
  for (const id of ['tagged', 'plain']) {
    db.prepare(`INSERT INTO students (student_id, class_group_id, admission_no, full_name) VALUES (?, 'c1', ?, ?)`).run(id, id, id);
  }
  // Two students with the same attendance, absent one day in three. Only one
  // has reasons on their absences (all "sick").
  recentWeekdays(60).forEach((date, i) => {
    const absent = i % 3 === 0;
    insert('tagged', date, absent ? 'absent' : 'present', absent ? 'health' : null);
    insert('plain', date, absent ? 'absent' : 'present');
  });
});

afterEach(() => db.close());

test('the risk score uses reasons stored on the server', () => {
  const flagged = new Map(getFlaggedStudents(db, 's1').map((f) => [f.studentId, f]));
  assert.ok(flagged.has('tagged') && flagged.has('plain'));
  assert.ok(flagged.get('tagged').dropoutProbability > flagged.get('plain').dropoutProbability,
    'sick absences raise the score above the same attendance with no reasons');
});

test('reasons on too few absences leave the score as it was', () => {
  // Strip the reason from most of the tagged student's absences.
  const rows = db.prepare(`SELECT event_id FROM attendance_events WHERE student_id = 'tagged' AND status = 'absent' ORDER BY date`).all();
  rows.forEach((r, i) => { if (i % 2) db.prepare(`UPDATE attendance_events SET reason = NULL WHERE event_id = ?`).run(r.event_id); });

  const history = (id) => db.prepare(`SELECT date, status, reason FROM attendance_events WHERE student_id = ? ORDER BY date`).all(id);
  const summary = absenceReasonSummary(history('tagged'));
  assert.ok(summary.coverage < REASON_COVERAGE_MIN);
  assert.equal(assessStudent(history('tagged')).dropoutProbability, assessStudent(history('plain')).dropoutProbability);
});

test('the overview reports how many recent absences have a reason', () => {
  const { absenceReasons } = getSchoolOverview(db, 's1');
  // Both students miss the same days; only the tagged one gave reasons.
  assert.ok(absenceReasons.absences > 0);
  assert.equal(absenceReasons.withReason * 2, absenceReasons.absences);
  assert.equal(absenceReasons.share, 0.5);
});

test('"unknown" does not count as a reason in the overview', () => {
  db.prepare(`UPDATE attendance_events SET reason = 'unknown' WHERE reason = 'health'`).run();
  assert.equal(getSchoolOverview(db, 's1').absenceReasons.withReason, 0);
});
