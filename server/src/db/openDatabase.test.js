import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Settings are read when config.js is first imported, so set them first.
// (node --test runs each test file in its own process.)
process.env.SQLITE_JOURNAL_MODE = 'DELETE';
const { config } = await import('../config.js');
const { openDatabase, withOpenRetry } = await import('./index.js');

const sqliteError = (code) => Object.assign(new Error(code), { code });

describe('opening the database', () => {
  // On Azure the database sits on a network share where WAL breaks; a merge
  // once dropped this setting and the server silently ran in WAL there.
  test('SQLITE_JOURNAL_MODE is honoured', () => {
    assert.equal(config.sqliteJournalMode, 'DELETE');
    const dir = mkdtempSync(join(tmpdir(), 'sa-open-'));
    const db = openDatabase(join(dir, 'test.db'), { retryMs: 0 });
    try {
      assert.equal(db.pragma('journal_mode', { simple: true }), 'delete');
      assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('retries while the file is locked, then opens', () => {
    let calls = 0;
    const slept = [];
    const result = withOpenRetry(() => {
      calls += 1;
      if (calls < 3) throw sqliteError(calls === 1 ? 'SQLITE_CANTOPEN' : 'SQLITE_BUSY');
      return 'opened';
    }, { timeoutMs: 60_000, sleep: (ms) => slept.push(ms), log: () => {} });
    assert.equal(result, 'opened');
    assert.equal(calls, 3);
    assert.deepEqual(slept, [500, 1000]);
  });

  test('gives up after the time limit and reports the error', () => {
    let t = 0;
    assert.throws(
      () => withOpenRetry(() => { throw sqliteError('SQLITE_CANTOPEN'); }, {
        timeoutMs: 10_000, sleep: (ms) => { t += ms; }, now: () => t, log: () => {},
      }),
      { code: 'SQLITE_CANTOPEN' },
    );
    assert.ok(t <= 10_000, `stopped within the limit (waited ${t}ms)`);
  });

  test('does not retry other errors', () => {
    let calls = 0;
    assert.throws(() => withOpenRetry(() => { calls += 1; throw sqliteError('SQLITE_CORRUPT'); }, {
      timeoutMs: 60_000, sleep: () => {}, log: () => {},
    }), { code: 'SQLITE_CORRUPT' });
    assert.equal(calls, 1);
  });
});
