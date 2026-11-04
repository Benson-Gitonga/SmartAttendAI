/**
 * Daily copies of the database.
 *
 * Uses SQLite's online backup (better-sqlite3 `db.backup`), which takes a
 * consistent copy while the server keeps reading and writing. One file per
 * day, `smartattend-YYYY-MM-DD.db` (UTC date), written to `<name>.partial`
 * first and renamed when complete, so a half-written copy never looks like a
 * backup. The newest `keepDays` copies are kept.
 *
 * On Azure the copies sit next to the database under /home, which survives
 * restarts and redeploys. They protect against a bad deploy, a corrupted file
 * or data deleted by mistake; they are not off-site.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BACKUP_FILE = /^smartattend-(\d{4}-\d{2}-\d{2})\.db$/;

export const isoDay = (date = new Date()) => date.toISOString().slice(0, 10);
export const backupFileName = (day) => `smartattend-${day}.db`;

/** Backups in `dir`, newest first: [{ day, file, bytes }]. */
export function listBackups(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, m: BACKUP_FILE.exec(name) }))
    .filter(({ m }) => m)
    .map(({ name, m }) => ({ day: m[1], file: join(dir, name), bytes: statSync(join(dir, name)).size }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/** Delete all but the newest `keepDays` backups. Returns the files removed. */
export function pruneBackups(dir, keepDays) {
  const removed = [];
  for (const old of listBackups(dir).slice(Math.max(1, keepDays))) {
    rmSync(old.file, { force: true });
    removed.push(old.file);
  }
  return removed;
}

/**
 * Write today's backup (replacing an earlier one from the same day) and prune.
 * @returns {Promise<{ file: string, bytes: number, removed: string[] }>}
 */
export async function backupDatabase(db, dir, { keepDays = 14, now = new Date() } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, backupFileName(isoDay(now)));
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  await db.backup(partial);
  rmSync(file, { force: true });
  renameSync(partial, file);
  return { file, bytes: statSync(file).size, removed: pruneBackups(dir, keepDays) };
}

/**
 * Back up once a day: shortly after start (if today has no backup yet), then
 * whenever an hourly check finds today's missing. Returns a stop function.
 */
export function startDailyBackups(db, { dir, keepDays = 14, firstDelayMs = 60_000, checkEveryMs = 60 * 60_000, log = console } = {}) {
  let running = false;
  const tick = async () => {
    if (running || existsSync(join(dir, backupFileName(isoDay())))) return;
    running = true;
    try {
      const { file, bytes, removed } = await backupDatabase(db, dir, { keepDays });
      log.log(`[backup] wrote ${file} (${Math.round(bytes / 1024)} KB)${removed.length ? `, removed ${removed.length} old` : ''}`);
    } catch (err) {
      log.error(`[backup] failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, firstDelayMs);
  const timer = setInterval(tick, checkEveryMs);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
