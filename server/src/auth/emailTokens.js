/**
 * Tokens for links sent by email (confirm email, set up an account, reset a
 * password). Unlike the 8-character codes a school admin reads out, these are
 * never typed, so they are long: 32 random bytes, base64url. Only a SHA-256
 * of the token is stored.
 */

import { createHash, randomBytes } from 'node:crypto';

export const EMAIL_TOKEN_TTL_MS = {
  verify_email: 7 * 24 * 60 * 60 * 1000,
  setup: 3 * 24 * 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000, // a teacher's set-up link
  reset: 60 * 60 * 1000,
};

export const generateEmailToken = () => randomBytes(32).toString('base64url');

export const hashEmailToken = (token) => createHash('sha256').update(String(token ?? '')).digest('hex');

/** Shape check before a lookup, so junk never reaches the database. */
export const looksLikeEmailToken = (token) => /^[A-Za-z0-9_-]{40,64}$/.test(String(token ?? ''));

/** The PWA page each kind of link opens. Hash routes, so they work on any static host. */
export function emailLink(appUrl, purpose, token) {
  const page = purpose === 'verify_email' ? 'verify-email' : 'set-password';
  return `${appUrl}/#/${page}/${token}`;
}
