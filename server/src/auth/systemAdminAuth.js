/**
 * Sign-in for the platform's system admin. There is one fixed account, set in
 * server/.env (SYSTEM_ADMIN_USERNAME and SYSTEM_ADMIN_PASSWORD_HASH, written by
 * `npm run sysadmin:set`), so it never ships in the PWA bundle. Only a scrypt
 * hash of the password is stored.
 *
 * A successful sign-in returns a token signed with SYSTEM_ADMIN_TOKEN_SECRET
 * (HMAC-SHA256) that expires after SYSTEM_ADMIN_TOKEN_TTL_HOURS. Every
 * /api/system-admin/* call except the sign-in must send it as
 * `Authorization: Bearer <token>`. Repeated wrong passwords from one address
 * are locked out for a while.
 */

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { createTokenSigner, createAttemptLimiter, bearerToken, sameText } from './tokens.js';

// scrypt cost settings. N = 2^14 keeps a sign-in well under 100 ms on a
// Raspberry Pi while making each guess expensive.
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

/** `scrypt:N:r:p:salt:hash`, base64url parts. No `$`, so .env files read it as-is. */
export function hashPassword(password, { salt = randomBytes(16) } = {}) {
  if (typeof password !== 'string' || password.length === 0) throw new Error('password is required');
  const key = scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64url');
  let actual;
  try {
    actual = scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * @param {object} opts
 * @param {string} opts.username       the system admin's sign-in name (e.g. "sysadmin")
 * @param {string} opts.passwordHash   from hashPassword()
 * @param {string} [opts.tokenSecret]  HMAC key; a random one per process when empty
 *                                     (every token then dies with a restart)
 * @param {number} [opts.tokenTtlMs]
 * @param {number} [opts.maxFailures]  wrong passwords allowed per address per window
 * @param {number} [opts.lockoutMs]
 * @param {() => number} [opts.now]
 */
export function createSystemAdminAuth({
  username = '',
  passwordHash = '',
  tokenSecret = '',
  tokenTtlMs = 8 * 60 * 60 * 1000,
  maxFailures = 5,
  lockoutMs = 15 * 60 * 1000,
  now = Date.now,
} = {}) {
  const configured = Boolean(username && passwordHash);
  const account = username.trim().toLowerCase();
  const signer = createTokenSigner(tokenSecret);
  const limiter = createAttemptLimiter({ maxFailures, lockoutMs, now });

  function issueToken() {
    const issuedAt = now();
    const claims = { sub: account, role: 'system_admin', iat: issuedAt, exp: issuedAt + tokenTtlMs };
    return { token: signer.sign(claims), username: account, expiresAt: claims.exp };
  }

  /**
   * @returns {{ok:true, token:string, username:string, expiresAt:number}
   *         | {ok:false, reason:'not_configured'|'locked'|'wrong', retryAfterMs?:number}}
   */
  function signIn(givenUsername, password, { from = 'unknown' } = {}) {
    if (!configured) return { ok: false, reason: 'not_configured' };
    const wait = limiter.lockedFor(from);
    if (wait > 0) return { ok: false, reason: 'locked', retryAfterMs: wait };

    // Always run the hash check, even for a wrong username, so the reply time
    // does not say whether the username was right.
    const passwordOk = verifyPassword(String(password ?? ''), passwordHash);
    const usernameOk = sameText(String(givenUsername ?? '').trim().toLowerCase(), account);
    if (!(passwordOk && usernameOk)) {
      const locked = limiter.fail(from);
      return locked > 0 ? { ok: false, reason: 'locked', retryAfterMs: locked } : { ok: false, reason: 'wrong' };
    }
    limiter.succeed(from);
    return { ok: true, ...issueToken() };
  }

  /** The token's claims, or null when it is missing, forged, for someone else or expired. */
  function verifyToken(token) {
    const claims = signer.verify(token, now());
    if (claims?.role !== 'system_admin' || claims.sub !== account) return null;
    return claims;
  }

  /** Express middleware: 401 without a valid token, 503 when no account is set up. */
  function requireSystemAdmin(req, res, next) {
    if (!configured) {
      return res.status(503).json({ error: 'system admin sign-in is not set up on this server (run npm run sysadmin:set)' });
    }
    const claims = verifyToken(bearerToken(req));
    if (!claims) return res.status(401).json({ error: 'sign in as the system admin first' });
    req.systemAdmin = claims;
    next();
  }

  return { configured, signIn, verifyToken, requireSystemAdmin };
}
