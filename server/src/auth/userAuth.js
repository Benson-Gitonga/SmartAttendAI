/**
 * Sign-in for school staff (school admins and teachers), checked against the
 * users table. Replaces Amazon Cognito: the server holds every account, so the
 * same email and password work on any device and a wrong password is refused.
 *
 * A sign-in returns a token signed with AUTH_TOKEN_SECRET that lasts
 * AUTH_TOKEN_TTL_DAYS (long, because a teacher may work offline for days and
 * the queued records are sent with it). The PWA stays signed in for as long
 * as the token lasts, and renews it whenever it is online.
 *
 * Every request re-reads the user, so disabling an account or its school
 * takes effect at once, without waiting for tokens to expire.
 */

import { verifyPassword, hashPassword } from './systemAdminAuth.js';
import { createTokenSigner, createAttemptLimiter, bearerToken } from './tokens.js';
import {
  findUserForSignIn, getUser, getSchool, recordSignIn, activateWithGoogle, findUserByGoogleSub, linkGoogleAccount,
} from '../db/repository.js';

// Checked against when the email is unknown, so a wrong email takes as long
// as a wrong password and the reply time does not say which it was.
const DUMMY_HASH = hashPassword('not a real password');

/** What the PWA is told about the signed-in person and their school. */
export function describeAccount(db, user) {
  const school = getSchool(db, user.schoolId);
  return {
    user: {
      userId: user.userId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      jobTitle: user.jobTitle,
      schoolId: user.schoolId,
      googleEmail: user.googleEmail ?? null,
    },
    school: school && {
      schoolId: school.schoolId,
      name: school.name,
      county: school.county,
      status: school.status,
      reviewNote: school.reviewNote,
      // For the applicant's progress page: what they sent and when it was decided.
      subCounty: school.subCounty,
      schoolCode: school.schoolCode,
      submittedAt: school.createdAt,
      reviewedAt: school.reviewedAt,
    },
  };
}

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {string} [opts.tokenSecret]
 * @param {number} [opts.tokenTtlMs]
 * @param {number} [opts.maxFailures]  wrong passwords per address + email before a lockout
 * @param {number} [opts.lockoutMs]
 * @param {() => number} [opts.now]
 */
export function createUserAuth({
  db,
  tokenSecret = '',
  tokenTtlMs = 30 * 24 * 60 * 60 * 1000,
  maxFailures = 5,
  lockoutMs = 15 * 60 * 1000,
  now = Date.now,
}) {
  if (!db) throw new Error('createUserAuth needs a db');
  const signer = createTokenSigner(tokenSecret);
  const limiter = createAttemptLimiter({ maxFailures, lockoutMs, now });

  function issueToken(user) {
    const issuedAt = now();
    const claims = { sub: user.userId, role: user.role, schoolId: user.schoolId, iat: issuedAt, exp: issuedAt + tokenTtlMs };
    return { token: signer.sign(claims), expiresAt: claims.exp };
  }

  /**
   * @returns {{ok:true, token:string, expiresAt:number, user:object, school:object}
   *         | {ok:false, reason:'wrong'|'locked'|'disabled'|'invited', retryAfterMs?:number}}
   */
  function signIn(email, password, { from = 'unknown' } = {}) {
    const key = `${from}|${String(email ?? '').trim().toLowerCase()}`;
    const wait = limiter.lockedFor(key);
    if (wait > 0) return { ok: false, reason: 'locked', retryAfterMs: wait };

    const user = findUserForSignIn(db, String(email ?? '').trim());
    const passwordOk = verifyPassword(String(password ?? ''), user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !passwordOk) {
      // An invited teacher has no password yet: say so only when the email
      // matches, which the invite code already revealed to them.
      if (user?.status === 'invited' && !user.passwordHash) return { ok: false, reason: 'invited' };
      const locked = limiter.fail(key);
      return locked > 0 ? { ok: false, reason: 'locked', retryAfterMs: locked } : { ok: false, reason: 'wrong' };
    }
    limiter.succeed(key);
    if (user.status === 'disabled') return { ok: false, reason: 'disabled' };

    recordSignIn(db, user.userId);
    return { ok: true, ...issueToken(user), ...describeAccount(db, user) };
  }

  /**
   * Sign in with a Google account (auth/googleAuth.js). Only finds an
   * account, never makes one, and the role always comes from that account:
   *   1. the user this Google account was linked to, whatever its email;
   *   2. else the user whose email Google has confirmed, and the Google
   *      account is linked to them from now on.
   * An invited user whose school is active is set up by this, as their
   * invite link would have done.
   *
   * @param {{sub: string, email: string, emailVerified: boolean}} google
   * @returns {{ok:true, token:string, expiresAt:number, user:object, school:object}
   *         | {ok:false, reason:'no_account'|'unverified'|'disabled'|'school_inactive'}}
   */
  function signInWithGoogle(google) {
    let user = findUserByGoogleSub(db, google?.sub);
    if (!user) {
      if (!google?.emailVerified) return { ok: false, reason: 'unverified' };
      user = findUserForSignIn(db, google.email);
      if (!user) return { ok: false, reason: 'no_account' };
      // Remember this Google account, unless the user already linked another.
      if (!user.googleSub && google.sub) user = linkGoogleAccount(db, user.userId, google).user ?? user;
    }
    if (user.status === 'disabled') return { ok: false, reason: 'disabled' };
    if (user.status === 'invited') {
      if (getSchool(db, user.schoolId)?.status !== 'active') return { ok: false, reason: 'school_inactive' };
      user = activateWithGoogle(db, user.userId);
    }
    recordSignIn(db, user.userId);
    return { ok: true, ...issueToken(user), ...describeAccount(db, user) };
  }

  /** The current user for a token, or null when the token or account is no longer good. */
  function userForToken(token) {
    const claims = signer.verify(token, now());
    if (!claims?.sub || (claims.role !== 'admin' && claims.role !== 'teacher')) return null;
    const user = getUser(db, claims.sub);
    if (!user || user.status !== 'active') return null;
    return user;
  }

  /**
   * Express middleware: 401 without a good token, 403 for the wrong role.
   * Sets req.user. Pass roles to restrict, e.g. requireUser('admin').
   */
  function requireUser(...roles) {
    return (req, res, next) => {
      const user = userForToken(bearerToken(req));
      if (!user) return res.status(401).json({ error: 'sign in first' });
      if (roles.length > 0 && !roles.includes(user.role)) {
        return res.status(403).json({ error: `only a school ${roles.join(' or ')} can do this` });
      }
      req.user = user;
      next();
    };
  }

  /**
   * After requireUser: 403 while the user's school is waiting for approval,
   * rejected or disabled. The PWA keeps queued records and retries later.
   */
  function requireActiveSchool(req, res, next) {
    const school = getSchool(db, req.user.schoolId);
    if (!school || school.status !== 'active') {
      return res.status(403).json({ error: 'school is not active', schoolId: req.user.schoolId, status: school?.status ?? null });
    }
    next();
  }

  return { signIn, signInWithGoogle, issueToken, userForToken, requireUser, requireActiveSchool };
}
