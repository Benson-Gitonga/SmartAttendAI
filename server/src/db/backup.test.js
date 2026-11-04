import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase, listBackups, pruneBackups, backupFileName } from './backup.js';

const tempDir = () => mkdtempSync(join(tmpdir(), 'sa-backup-'));

describe('database backups', () => {
  test('writes a complete, readable copy named for the day', async () => {
    const dir = tempDir();
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2), (3);`);
    try {
      const { file, bytes } = await backupDatabase(db, dir, { now: new Date('2026-11-04T10:00:00Z') });
      assert.equal(file, join(dir, 'smartattend-2026-11-04.db'));
      assert.ok(bytes > 0);
      assert.equal(existsSync(`${file}.partial`), false, 'no half-written file left behind');
      const copy = new Database(file, { readonly: true });
      assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM t').get().n, 3);
      copy.close();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a second backup the same day replaces the first', async () => {
    const dir = tempDir();
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    try {
      const now = new Date('2026-11-04T10:00:00Z');
      await backupDatabase(db, dir, { now });
      db.exec('INSERT INTO t VALUES (42)');
      await backupDatabase(db, dir, { now });
      assert.equal(listBackups(dir).length, 1);
      const copy = new Database(join(dir, backupFileName('2026-11-04')), { readonly: true });
      assert.equal(copy.prepare('SELECT x FROM t').get().x, 42);
      copy.close();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps only the newest copies, and ignores other files', () => {
    const dir = tempDir();
    try {
      for (const day of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
        writeFileSync(join(dir, backupFileName(day)), 'x');
      }
      writeFileSync(join(dir, 'notes.txt'), 'keep me');
      const removed = pruneBackups(dir, 2);
      assert.equal(removed.length, 2);
      assert.deepEqual(listBackups(dir).map((b) => b.day), ['2026-10-04', '2026-10-03']);
      assert.ok(existsSync(join(dir, 'notes.txt')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('never deletes the last remaining copy', () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, backupFileName('2026-10-01')), 'x');
      pruneBackups(dir, 0);
      assert.equal(listBackups(dir).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
