import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(here, 'schema.sql');

/**
 * Open a database and apply the schema. Safe to run on every boot.
 *
 * @param {string} path  file path, or ':memory:' for an ephemeral DB (tests)
 */
export function openDatabase(path = config.dbPath) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');   // concurrent reads while the simulation writes
  db.pragma('foreign_keys = ON');    // not on by default in SQLite

  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  migrate(db);
  return db;
}

/** Columns added after a table was first created. Safe to run on every boot. */
export function migrate(db) {
  const hasColumn = (table, column) =>
    db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column) != null;

  if (!hasColumn('class_groups', 'teacher_name')) {
    db.exec(`ALTER TABLE class_groups ADD COLUMN teacher_name TEXT`);
  }
  if (!hasColumn('students', 'guardian_phone')) {
    db.exec(`ALTER TABLE students ADD COLUMN guardian_phone TEXT`);
  }
  if (!hasColumn('students', 'guardian_email')) {
    db.exec(`ALTER TABLE students ADD COLUMN guardian_email TEXT`);
  }
  if (!hasColumn('schools', 'status')) {
    db.exec(`ALTER TABLE schools ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))`);
  }
  if (!hasColumn('attendance_events', 'reason')) {
    db.exec(`ALTER TABLE attendance_events ADD COLUMN reason TEXT CHECK (reason IN ('fee', 'health', 'other', 'unknown'))`);
  }
  rebuildSchoolsForApproval(db);
}

/**
 * School approval added 'pending' and 'rejected' to the status CHECK, and
 * SQLite cannot alter a CHECK in place, so an older schools table is copied
 * into a new one. Foreign keys are off during the swap so dropping the old
 * table does not cascade into class_groups.
 */
function rebuildSchoolsForApproval(db) {
  const { sql } = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'schools'`).get();
  if (sql.includes("'pending'")) return;

  const brokenKeys = () => db.prepare('PRAGMA foreign_key_check(class_groups)').all().length;
  const brokenBefore = brokenKeys();

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE schools_new (
          school_id   TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          county      TEXT,
          status      TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('pending', 'active', 'inactive', 'rejected')),
          admin_name  TEXT,
          admin_email TEXT,
          admin_phone TEXT,
          review_note TEXT,
          reviewed_by TEXT,
          reviewed_at TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO schools_new (school_id, name, county, status, created_at)
          SELECT school_id, name, county, status, created_at FROM schools;
        DROP TABLE schools;
        ALTER TABLE schools_new RENAME TO schools;
      `);
      const broken = brokenKeys() - brokenBefore;
      if (broken > 0) throw new Error(`schools rebuild broke ${broken} class foreign key(s)`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

let singleton = null;

export function getDb() {
  if (!singleton) singleton = openDatabase();
  return singleton;
}

export function closeDb() {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
