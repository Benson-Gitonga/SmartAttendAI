/**
 * Sign-in for the platform's system admin. There is one fixed account, set in
 * server/.env (SYSTEM_ADMIN_EMAIL and SYSTEM_ADMIN_PASSWORD_HASH, written by
 * `npm run sysadmin:set`), so it never ships in the PWA bundle. Only a scrypt
 * hash of the password is stored.
 *
 * A successful sign-in returns a token signed with SYSTEM_ADMIN_TOKEN_SECRET
 * (HMAC-SHA256) that expires after SYSTEM_ADMIN_TOKEN_TTL_HOURS. Every
 * /api/system-admin/* call except the sign-in must send it as
 * `Authorization: Bearer <token>`. Repeated wrong passwords from one address
 * are locked out for a while.
 */

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

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

const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');

const sameText = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * @param {object} opts
 * @param {string} opts.email          the system admin's sign-in email
 * @param {string} opts.passwordHash   from hashPassword()
 * @param {string} [opts.tokenSecret]  HMAC key; a random one per process when empty
 *                                     (every token then dies with a restart)
 * @param {number} [opts.tokenTtlMs]
 * @param {number} [opts.maxFailures]  wrong passwords allowed per address per window
 * @param {number} [opts.lockoutMs]
 * @param {() => number} [opts.now]
 */
export function createSystemAdminAuth({
  email = '',
  passwordHash = '',
  tokenSecret = '',
  tokenTtlMs = 8 * 60 * 60 * 1000,
  maxFailures = 5,
  lockoutMs = 15 * 60 * 1000,
  now = Date.now,
} = {}) {
  const configured = Boolean(email && passwordHash);
  const secret = tokenSecret || randomBytes(32).toString('base64url');
  const account = email.trim().toLowerCase();

  // address -> { failures, firstAt, lockedUntil }
  const attempts = new Map();

  function lockedFor(key) {
    const entry = attempts.get(key);
    if (!entry) return 0;
    const left = (entry.lockedUntil ?? 0) - now();
    if (left > 0) return left;
    if (now() - entry.firstAt > lockoutMs) attempts.delete(key);
    return 0;
  }

  function recordFailure(key) {
    const t = now();
    const entry = attempts.get(key);
    const fresh = !entry || t - entry.firstAt > lockoutMs;
    const next = fresh ? { failures: 1, firstAt: t } : { ...entry, failures: entry.failures + 1 };
    if (next.failures >= maxFailures) next.lockedUntil = t + lockoutMs;
    attempts.set(key, next);
  }

  function issueToken() {
    const issuedAt = now();
    const payload = { sub: account, role: 'system_admin', iat: issuedAt, exp: issuedAt + tokenTtlMs };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { token: `${body}.${sign(secret, body)}`, email: account, expiresAt: payload.exp };
  }

  /**
   * @returns {{ok:true, token:string, email:string, expiresAt:number}
   *         | {ok:false, reason:'not_configured'|'locked'|'wrong', retryAfterMs?:number}}
   */
  function signIn(givenEmail, password, { from = 'unknown' } = {}) {
    if (!configured) return { ok: false, reason: 'not_configured' };
    const wait = lockedFor(from);
    if (wait > 0) return { ok: false, reason: 'locked', retryAfterMs: wait };

    // Always run the hash check, even for a wrong email, so the reply time
    // does not say whether the email was right.
    const passwordOk = verifyPassword(String(password ?? ''), passwordHash);
    const emailOk = sameText(String(givenEmail ?? '').trim().toLowerCase(), account);
    if (!(passwordOk && emailOk)) {
      recordFailure(from);
      const locked = lockedFor(from);
      return locked > 0 ? { ok: false, reason: 'locked', retryAfterMs: locked } : { ok: false, reason: 'wrong' };
    }
    attempts.delete(from);
    return { ok: true, ...issueToken() };
  }

  /** The token's claims, or null when it is missing, forged, for someone else or expired. */
  function verifyToken(token) {
    if (typeof token !== 'string') return null;
    const [body, mac, extra] = token.split('.');
    if (!body || !mac || extra !== undefined) return null;
    if (!sameText(mac, sign(secret, body))) return null;
    let claims;
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (claims?.role !== 'system_admin' || claims.sub !== account) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= now()) return null;
    return claims;
  }

  /** Express middleware: 401 without a valid token, 503 when no account is set up. */
  function requireSystemAdmin(req, res, next) {
    if (!configured) {
      return res.status(503).json({ error: 'system admin sign-in is not set up on this server (run npm run sysadmin:set)' });
    }
    const header = req.get('authorization') ?? '';
    const claims = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!claims) return res.status(401).json({ error: 'sign in as the system admin first' });
    req.systemAdmin = claims;
    next();
  }

  return { configured, signIn, verifyToken, requireSystemAdmin };
}
