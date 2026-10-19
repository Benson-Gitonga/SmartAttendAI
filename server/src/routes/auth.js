/**
 * /api/auth/*: school staff sign in, look up who they are, and set a password
 * with a one-time code from their school admin. See auth/userAuth.js and
 * auth/setupCodes.js.
 */

import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { signInSchema, setupCodeSchema } from '../schemas/schoolRegistration.schema.js';
import { describeAccount } from '../auth/userAuth.js';
import { hashPassword } from '../auth/systemAdminAuth.js';
import { createAttemptLimiter } from '../auth/tokens.js';
import { logAudit, lookupSetupCode, redeemSetupCode } from '../db/repository.js';

const REFUSED = {
  wrong: [401, 'Wrong email or password.'],
  disabled: [403, 'This account has been disabled. Ask your school admin.'],
  invited: [403, 'This account has not been set up yet. Use your invite code first.'],
};

// Why a code cannot be used, in words a teacher can act on.
const CODE_PROBLEMS = {
  unknown: [404, 'That code is not right. Check it with your school admin.'],
  used: [410, 'That code has already been used. Sign in with your password, or ask your school admin for a new code.'],
  revoked: [410, 'That code no longer works. Ask your school admin for a new one.'],
  expired: [410, 'That code has expired. Ask your school admin for a new one.'],
};

export function createAuthRouter({ db, userAuth, codeLimiter = createAttemptLimiter({ maxFailures: 10, lockoutMs: 15 * 60 * 1000 }) }) {
  if (!db) throw new Error('createAuthRouter needs a db');
  if (!userAuth) throw new Error('createAuthRouter needs userAuth');
  const router = Router();

  router.post('/login', (req, res) => {
    const { valid } = validate(signInSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'Enter your email and password.' });

    const { email, password } = req.body;
    const result = userAuth.signIn(email, password, { from: req.ip });
    if (result.ok) {
      logAudit(db, { action: 'user.signed_in', actorId: result.user.email, recordId: result.user.userId, detail: { ip: req.ip } });
      const { ok, ...body } = result; // eslint-disable-line no-unused-vars
      return res.json(body);
    }

    logAudit(db, { action: 'user.sign_in_failed', detail: { ip: req.ip, reason: result.reason } });
    if (result.reason === 'locked') {
      const seconds = Math.ceil(result.retryAfterMs / 1000);
      res.set('Retry-After', String(seconds));
      return res.status(429).json({ error: 'Too many wrong attempts. Try again later.', retryAfterSeconds: seconds });
    }
    const [status, error] = REFUSED[result.reason] ?? REFUSED.wrong;
    res.status(status).json({ error, reason: result.reason });
  });

  router.get('/me', userAuth.requireUser(), (req, res) => {
    res.json(describeAccount(db, req.user));
  });

  // One-time codes. Wrong codes from one address are counted, so codes
  // cannot be guessed by trying many.
  const tooMany = (req, res) => {
    const wait = codeLimiter.lockedFor(req.ip);
    if (wait <= 0) return false;
    res.set('Retry-After', String(Math.ceil(wait / 1000)));
    res.status(429).json({ error: 'Too many wrong codes. Try again in a few minutes.' });
    return true;
  };
  const refuse = (req, res, state) => {
    if (state === 'unknown') codeLimiter.fail(req.ip);
    const [status, error] = CODE_PROBLEMS[state] ?? CODE_PROBLEMS.unknown;
    return res.status(status).json({ error, state });
  };

  // Who the code is for, so the page can say "Welcome, Ms. Otieno".
  router.get('/setup-codes/:code', (req, res) => {
    if (tooMany(req, res)) return undefined;
    const found = lookupSetupCode(db, req.params.code);
    if (found.state !== 'ok') return refuse(req, res, found.state);
    const { fullName, email, schoolName, purpose, expiresAt } = found;
    res.json({ fullName, email, schoolName, purpose, expiresAt });
  });

  // Set the password and sign straight in.
  router.post('/setup', (req, res) => {
    if (tooMany(req, res)) return undefined;
    const { valid } = validate(setupCodeSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'Enter the code and a password of at least 8 characters.' });

    const found = lookupSetupCode(db, req.body.code);
    if (found.state !== 'ok') return refuse(req, res, found.state);
    const user = redeemSetupCode(db, req.body.code, hashPassword(req.body.password));
    if (!user) return refuse(req, res, 'revoked');

    codeLimiter.succeed(req.ip);
    logAudit(db, { action: 'user.signed_in', actorId: user.email, recordId: user.userId, detail: { ip: req.ip, via: found.purpose } });
    res.json({ ...userAuth.issueToken(user), ...describeAccount(db, user) });
  });

  return router;
}
