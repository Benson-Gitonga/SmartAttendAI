/**
 * /api/system-admin/*: the platform's school list. A system admin approves or
 * rejects newly registered schools, and disables or enables approved ones.
 * Every endpoint except POST /login needs the system admin's token (see
 * auth/systemAdminAuth.js).
 */

import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { schoolReviewSchema } from '../schemas/schoolRegistration.schema.js';
import {
  getAllSchools,
  getSchool,
  countSchoolsByStatus,
  changeSchoolStatus,
  setSchoolStatus,
  SCHOOL_STATUSES,
  SchoolTransitionError,
  isSchoolAdminVerified,
  logAudit,
} from '../db/repository.js';

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {ReturnType<typeof createSystemAdminAuth>} opts.auth
 * @param {ReturnType<import('../mail/accountEmails.js').createAccountEmails>} opts.emails
 */
export function createSystemAdminRouter({ db, auth, emails }) {
  if (!db) throw new Error('createSystemAdminRouter needs a db');
  if (!auth) throw new Error('createSystemAdminRouter needs auth');
  if (!emails) throw new Error('createSystemAdminRouter needs emails');
  const router = Router();

  // The only endpoint open without a token.
  router.post('/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'enter the username and password' });
    }
    const result = auth.signIn(username, password, { from: req.ip });
    if (result.ok) {
      logAudit(db, { action: 'system_admin.signed_in', actorId: result.username, detail: { ip: req.ip } });
      const { token, username: who, expiresAt } = result;
      return res.json({ token, username: who, expiresAt });
    }
    if (result.reason === 'not_configured') {
      return res.status(503).json({ error: 'system admin sign-in is not set up on this server' });
    }
    logAudit(db, { action: 'system_admin.sign_in_failed', actorId: null, detail: { ip: req.ip, reason: result.reason } });
    if (result.reason === 'locked') {
      const seconds = Math.ceil(result.retryAfterMs / 1000);
      res.set('Retry-After', String(seconds));
      return res.status(429).json({ error: 'too many wrong attempts, try again later', retryAfterSeconds: seconds });
    }
    res.status(401).json({ error: 'wrong username or password' });
  });

  router.use(auth.requireSystemAdmin);

  router.get('/me', (req, res) => {
    res.json({ username: req.systemAdmin.sub, expiresAt: req.systemAdmin.exp });
  });

  router.get('/schools', (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !SCHOOL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${SCHOOL_STATUSES.join(', ')}` });
    }
    res.json({ schools: getAllSchools(db, { status }), counts: countSchoolsByStatus(db) });
  });

  /**
   * Run a status change. Returns the school, or null after answering with the
   * failure (404 unknown school, 409 a change that is not allowed).
   */
  const transition = (res, run) => {
    try {
      const school = run();
      if (!school) res.status(404).json({ error: 'school not found' });
      return school;
    } catch (err) {
      if (err instanceof SchoolTransitionError) {
        res.status(409).json({ error: err.message, from: err.from, to: err.to });
        return null;
      }
      throw err;
    }
  };

  const requireFrom = (schoolId, from, label) => {
    const current = getSchool(db, schoolId);
    if (current && from && current.status !== from) throw new SchoolTransitionError(current.status, label);
  };

  // approve / reject / disable / enable, each with an optional note. The actor is
  // always the signed-in system admin, never something the request claims.
  // A rejection must say why, so the school admin knows what to fix.
  const ACTIONS = { approve: 'active', reject: 'rejected', disable: 'inactive', enable: 'active' };
  const EXPECTED_FROM = { approve: 'pending', enable: 'inactive' };

  for (const [action, status] of Object.entries(ACTIONS)) {
    router.post(`/schools/:id/${action}`, async (req, res, next) => {
      const body = req.body ?? {};
      const { valid, errors } = validate(schoolReviewSchema, body);
      if (!valid) return res.status(400).json({ error: 'invalid request', errors });
      if (action === 'reject' && !body.note?.trim()) {
        return res.status(400).json({ error: 'give a reason for the rejection' });
      }
      // An application is only reviewed once its applicant has confirmed their
      // email, so the set-up link is sure to reach a real inbox.
      if (action === 'approve' && getSchool(db, req.params.id)?.status === 'pending' && !isSchoolAdminVerified(db, req.params.id)) {
        return res.status(409).json({ error: 'The applicant has not confirmed their email yet.', reason: 'email_not_verified' });
      }

      const school = transition(res, () => {
        // approve and enable both land on 'active', so check the starting
        // point too: approving a disabled school is not an approval.
        requireFrom(req.params.id, EXPECTED_FROM[action], action === 'approve' ? 'approved' : 'enabled');
        return changeSchoolStatus(db, req.params.id, status, { actor: req.systemAdmin.sub, note: body.note });
      });
      if (!school) return undefined;

      // The decision goes to the applicant. A failed email does not undo it;
      // they can get a fresh link from "Forgot password".
      try {
        let email = null;
        if (action === 'approve') email = await emails.schoolApproved(school.schoolId);
        if (action === 'reject') email = await emails.schoolRejected(school.schoolId, body.note.trim());
        res.json(email ? { ...school, emailSent: email.sent } : school);
      } catch (err) {
        next(err);
      }
    });
  }

  // The original toggle, kept for older clients: { status: 'active' | 'inactive' }.
  router.post('/schools/:id/status', (req, res) => {
    const { status, note = null } = req.body ?? {};
    const actor = req.systemAdmin.sub;
    if (status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
    }
    const school = transition(res, () => {
      // Turning a pending school on here would skip the approval step.
      if (status === 'active') requireFrom(req.params.id, 'inactive', 'enabled');
      return setSchoolStatus(db, req.params.id, status, { actor, note });
    });
    if (school) res.json(school);
  });

  return router;
}
