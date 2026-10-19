/**
 * Pieces shared by every sign-in on this server (system admin and school
 * staff): signed tokens and a lockout for repeated wrong passwords.
 *
 * A token is `base64url(JSON claims).base64url(HMAC-SHA256)`. It is not
 * encrypted, so claims hold ids and roles only, never anything secret.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sameText = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * @param {string} [secret] HMAC key; a random one per process when empty, so
 *   every token then dies with a restart.
 */
export function createTokenSigner(secret = '') {
  const key = secret || randomBytes(32).toString('base64url');
  const mac = (data) => createHmac('sha256', key).update(data).digest('base64url');

  return {
    sign(claims) {
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${body}.${mac(body)}`;
    },

    /** The claims, or null for a missing, forged, malformed or expired token. */
    verify(token, now = Date.now()) {
      if (typeof token !== 'string') return null;
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra !== undefined) return null;
      if (!sameText(signature, mac(body))) return null;
      let claims;
      try {
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (typeof claims?.exp !== 'number' || claims.exp <= now) return null;
      return claims;
    },
  };
}

/** The bearer token from an Express request, or null. */
export function bearerToken(req) {
  const header = req.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * Counts wrong passwords per key (an address, or address + account) and locks
 * that key out for `lockoutMs` after `maxFailures` within the window.
 */
export function createAttemptLimiter({ maxFailures = 5, lockoutMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const attempts = new Map(); // key -> { failures, firstAt, lockedUntil }

  function lockedFor(key) {
    const entry = attempts.get(key);
    if (!entry) return 0;
    const left = (entry.lockedUntil ?? 0) - now();
    if (left > 0) return left;
    if (now() - entry.firstAt > lockoutMs) attempts.delete(key);
    return 0;
  }

  function fail(key) {
    const t = now();
    const entry = attempts.get(key);
    const fresh = !entry || t - entry.firstAt > lockoutMs;
    const next = fresh ? { failures: 1, firstAt: t } : { ...entry, failures: entry.failures + 1 };
    if (next.failures >= maxFailures) next.lockedUntil = t + lockoutMs;
    attempts.set(key, next);
    return lockedFor(key);
  }

  const succeed = (key) => attempts.delete(key);

  return { lockedFor, fail, succeed };
}
