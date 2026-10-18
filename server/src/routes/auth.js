/** /api/auth/*: school staff sign in and look up who they are. See auth/userAuth.js. */

import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { signInSchema } from '../schemas/schoolRegistration.schema.js';
import { describeAccount } from '../auth/userAuth.js';
import { logAudit } from '../db/repository.js';

const REFUSED = {
  wrong: [401, 'Wrong email or password.'],
  disabled: [403, 'This account has been disabled. Ask your school admin.'],
  invited: [403, 'This account has not been set up yet. Use your invite code first.'],
};

export function createAuthRouter({ db, userAuth }) {
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

  return router;
}
