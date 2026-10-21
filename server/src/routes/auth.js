/**
 * /api/auth/*: school staff sign in, look up who they are, set a password
 * with a one-time code from their school admin or a link sent by email,
 * confirm their email, and ask for a password reset. See auth/userAuth.js,
 * auth/setupCodes.js and auth/emailTokens.js.
 */

import { Router } from 'express';
import { validate } from '../lib/validate.js';
import {
  signInSchema, setupCodeSchema, setPasswordSchema, emailTokenSchema, forgotPasswordSchema,
} from '../schemas/schoolRegistration.schema.js';
import { describeAccount } from '../auth/userAuth.js';
import { hashPassword } from '../auth/systemAdminAuth.js';
import { createAttemptLimiter } from '../auth/tokens.js';
import {
  logAudit, lookupSetupCode, redeemSetupCode, lookupEmailToken, confirmEmailWithToken, setPasswordWithToken,
} from '../db/repository.js';

const REFUSED = {
  wrong: [401, 'Wrong email or password.'],
  disabled: [403, 'This account has been disabled. Ask your school admin.'],
  invited: [403, 'This account is not set up yet. Use the link in your email, or "Forgot password" to get a new one.'],
};

// Why an emailed link cannot be used.
const LINK_PROBLEMS = {
  unknown: [404, 'This link is not valid. Check you copied all of it, or ask for a new one.'],
  used: [410, 'This link has already been used. Sign in, or use "Forgot password" for a new link.'],
  revoked: [410, 'This link no longer works because a newer one was sent. Use the most recent email.'],
  expired: [410, 'This link has expired. Use "Forgot password" on the sign-in page to get a new one.'],
  wrong_kind: [400, 'This link is for something else. Open it from the email it came in.'],
};

const FORGOT_REPLY = 'If that email has a SmartAttend account, we have sent it a link. Check your inbox and spam folder.';

// Why a code cannot be used, in words a teacher can act on.
const CODE_PROBLEMS = {
  unknown: [404, 'That code is not right. Check it with your school admin.'],
  used: [410, 'That code has already been used. Sign in with your password, or ask your school admin for a new code.'],
  revoked: [410, 'That code no longer works. Ask your school admin for a new one.'],
  expired: [410, 'That code has expired. Ask your school admin for a new one.'],
};

export function createAuthRouter({
  db,
  userAuth,
  emails,
  codeLimiter = createAttemptLimiter({ maxFailures: 10, lockoutMs: 15 * 60 * 1000 }),
  // Reset emails per address and per email: enough for a typo or two, not for spamming someone.
  forgotLimiter = createAttemptLimiter({ maxFailures: 5, lockoutMs: 15 * 60 * 1000 }),
}) {
  if (!db) throw new Error('createAuthRouter needs a db');
  if (!userAuth) throw new Error('createAuthRouter needs userAuth');
  if (!emails) throw new Error('createAuthRouter needs emails');
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

  // A fresh token for a signed-in device, so someone who opens the app
  // regularly never reaches the end of their sign-in.
  router.post('/refresh', userAuth.requireUser(), (req, res) => {
    res.json({ ...userAuth.issueToken(req.user), ...describeAccount(db, req.user) });
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

  // Links sent by email. Unknown tokens count against the address like wrong codes.
  const refuseLink = (req, res, state) => {
    if (state === 'unknown') codeLimiter.fail(req.ip);
    const [status, error] = LINK_PROBLEMS[state] ?? LINK_PROBLEMS.unknown;
    return res.status(status).json({ error, state });
  };

  // What a link is for, so the page can greet the person before they act.
  router.get('/links/:token', (req, res) => {
    if (tooMany(req, res)) return undefined;
    const found = lookupEmailToken(db, req.params.token);
    if (found.state !== 'ok') return refuseLink(req, res, found.state);
    const { purpose, email, fullName, role, schoolName, schoolStatus, expiresAt } = found;
    res.json({ purpose, email, fullName, role, schoolName, schoolStatus, expiresAt });
  });

  // An applicant confirms their email. The school then shows as ready for review.
  router.post('/verify-email', (req, res) => {
    if (tooMany(req, res)) return undefined;
    const { valid } = validate(emailTokenSchema, req.body ?? {});
    if (!valid) return refuseLink(req, res, 'unknown');
    const found = lookupEmailToken(db, req.body.token);
    if (found.state !== 'ok') return refuseLink(req, res, found.state);
    if (found.purpose !== 'verify_email') return refuseLink(req, res, 'wrong_kind');
    const user = confirmEmailWithToken(db, req.body.token);
    if (!user) return refuseLink(req, res, 'revoked');
    codeLimiter.succeed(req.ip);
    res.json({ email: user.email, schoolName: found.schoolName, schoolStatus: found.schoolStatus });
  });

  // First password (set-up link) or a new one (reset link); signs straight in.
  router.post('/set-password', (req, res) => {
    if (tooMany(req, res)) return undefined;
    const { valid } = validate(setPasswordSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'Choose a password of at least 8 characters.' });
    const found = lookupEmailToken(db, req.body.token);
    if (found.state !== 'ok') return refuseLink(req, res, found.state);
    if (found.purpose === 'verify_email') return refuseLink(req, res, 'wrong_kind');
    if (found.schoolStatus !== 'active') {
      return res.status(403).json({ error: 'Your school is not active on SmartAttend right now, so the account cannot be set up yet.', state: 'school_inactive' });
    }

    const user = setPasswordWithToken(db, req.body.token, hashPassword(req.body.password));
    if (!user) return refuseLink(req, res, 'revoked');
    codeLimiter.succeed(req.ip);
    logAudit(db, { action: 'user.signed_in', actorId: user.email, recordId: user.userId, detail: { ip: req.ip, via: `${found.purpose}_link` } });
    res.json({ ...userAuth.issueToken(user), ...describeAccount(db, user) });
  });

  // Always the same reply, so nobody can find out which emails have accounts.
  router.post('/forgot-password', (req, res, next) => forgotPassword(req, res).catch(next));
  async function forgotPassword(req, res) {
    const { valid } = validate(forgotPasswordSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'Enter the email address you sign in with.' });
    const email = req.body.email.trim().toLowerCase();
    for (const key of [`ip:${req.ip}`, `email:${email}`]) {
      const wait = forgotLimiter.lockedFor(key);
      if (wait > 0) {
        res.set('Retry-After', String(Math.ceil(wait / 1000)));
        return res.status(429).json({ error: 'Too many requests. Wait a few minutes, then try again.' });
      }
    }
    forgotLimiter.fail(`ip:${req.ip}`);
    forgotLimiter.fail(`email:${email}`);

    const result = await emails.passwordHelp(email);
    logAudit(db, { action: 'user.password_help_requested', actorId: email, detail: { ip: req.ip, outcome: result.reason ?? (result.sent ? 'sent' : 'failed') } });
    res.json({ message: FORGOT_REPLY });
  }

  return router;
}
