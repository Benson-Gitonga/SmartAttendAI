/**
 * The day the admin is looking at, shared between the Today board and a class
 * page so opening a class from yesterday's board shows yesterday's register.
 * Kept for the browser tab only; a new visit starts on today.
 */

import { todayISO } from '../../db/database';

const KEY = 'smartattend:admin-date';

export function readAdminDate() {
  try {
    const value = sessionStorage.getItem(KEY);
    return value && value <= todayISO() ? value : todayISO();
  } catch {
    return todayISO();
  }
}

export function writeAdminDate(date) {
  try { sessionStorage.setItem(KEY, date); } catch { /* private mode */ }
}
