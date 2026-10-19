/**
 * One-time codes for teachers: a school admin invites a teacher (or resets a
 * forgotten password) and passes the code on by WhatsApp, SMS, email or on
 * paper. The teacher enters it with a new password.
 *
 * Codes are 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
 * shown as XXXX-XXXX. That is 32^8 ≈ 10^12 codes, and wrong guesses are
 * rate-limited, so they cannot be guessed. Only a SHA-256 of the code is
 * stored; how it is typed (case, spaces, dashes) does not matter.
 */

import { createHash, randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateCode() {
  let raw = '';
  for (let i = 0; i < 8; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** "k7qm 4xpa", "K7QM-4XPA" and "k7qm4xpa" are the same code. */
export function normalizeCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashCode(code) {
  return createHash('sha256').update(normalizeCode(code)).digest('hex');
}

/** True when the code has the right shape, before looking anything up. */
export const looksLikeCode = (code) => normalizeCode(code).length === 8;
