import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

process.env.SQLITE_JOURNAL_MODE = 'DELETE';
const { openDatabase } = await import('./index.js');

const here = dirname(fileURLToPath(import.meta.url));

/** A database as older builds created it: old card table name and capture values. */
function makeOldDatabase(path) {
  const oldSchema = readFileSync(resolve(here, 'schema.sql'), 'utf8')
    .replaceAll('id_cards', 'rfid_cards')
    .replaceAll('idx_cards_', 'idx_rfid_')
    .replace("capture_method IN ('manual', 'card', 'import')", "capture_method IN ('manual', 'rfid', 'fingerprint', 'import')");
  const db = new Database(path);
  db.exec(oldSchema);
  db.exec(`
    INSERT INTO schools (school_id, name) VALUES ('sch-1', 'Old School');
    INSERT INTO class_groups (class_group_id, school_id, grade, stream, academic_year)
      VALUES ('cls-1', 'sch-1', 'Form 2', 'C', 2026);
    INSERT INTO students (student_id, class_group_id, admission_no, full_name)
      VALUES ('stu-1', 'cls-1', '2C/001', 'Amina'), ('stu-2', 'cls-1', '2C/002', 'Brian'), ('stu-3', 'cls-1', '2C/003', 'Chris');
    INSERT INTO rfid_cards (card_uid, student_id, active) VALUES ('A1B2C3D4', 'stu-1', 1), ('0000OLD1', 'stu-1', 0);
    INSERT INTO attendance_events (event_id, student_id, date, status, capture_method)
      VALUES ('evt-1', 'stu-1', '2026-11-02', 'present', 'rfid'),
             ('evt-2', 'stu-2', '2026-11-02', 'present', 'fingerprint'),
             ('evt-3', 'stu-3', '2026-11-02', 'absent', 'manual');
    INSERT INTO sync_queue (event_id) VALUES ('evt-1'), ('evt-2'), ('evt-3');
  `);
  db.close();
}

test('an older database is upgraded to id_cards and the card capture method', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sa-cards-'));
  const path = join(dir, 'old.db');
  makeOldDatabase(path);

  const db = openDatabase(path, { retryMs: 0 });
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((t) => t.name);
    assert.ok(tables.includes('id_cards'));
    assert.ok(!tables.includes('rfid_cards'));
    assert.deepEqual(
      db.prepare('SELECT card_uid, active FROM id_cards ORDER BY card_uid').all(),
      [{ card_uid: '0000OLD1', active: 0 }, { card_uid: 'A1B2C3D4', active: 1 }],
    );

    assert.deepEqual(
      db.prepare('SELECT event_id, capture_method FROM attendance_events ORDER BY event_id').all(),
      [
        { event_id: 'evt-1', capture_method: 'card' },
        { event_id: 'evt-2', capture_method: 'card' },
        { event_id: 'evt-3', capture_method: 'manual' },
      ],
    );
    // the queue rows still point at their events
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_queue').get().n, 3);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    // new rows can use 'card'; old values are refused
    db.prepare(`INSERT INTO attendance_events (event_id, student_id, date, status, capture_method)
                VALUES ('evt-4', 'stu-1', '2026-11-03', 'present', 'card')`).run();
    assert.throws(() => db.prepare(`INSERT INTO attendance_events (event_id, student_id, date, status, capture_method)
                VALUES ('evt-5', 'stu-2', '2026-11-03', 'present', 'rfid')`).run());
    // one active card per student is still enforced
    assert.throws(() => db.prepare(`INSERT INTO id_cards (card_uid, student_id, active) VALUES ('NEWCARD1', 'stu-1', 1)`).run());
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('opening an upgraded database again changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sa-cards-'));
  const path = join(dir, 'old.db');
  makeOldDatabase(path);
  openDatabase(path, { retryMs: 0 }).close();

  const db = openDatabase(path, { retryMs: 0 });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM id_cards').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_events').get().n, 3);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
