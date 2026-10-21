/**
 * /api/schools/*: a school applies to join SmartAttend, and anyone can look
 * up a school's status (name, status and review note only).
 */

import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { schoolRegistrationSchema } from '../schemas/schoolRegistration.schema.js';
import { registerSchoolApplication, getSchool, RegistrationConflictError } from '../db/repository.js';
import { hashPassword } from '../auth/systemAdminAuth.js';

/** What anyone may see about a school. */
export function publicSchool(school) {
  const { schoolId, name, county, status, reviewNote, reviewedAt, createdAt } = school;
  return { schoolId, name, county, status, reviewNote, reviewedAt, createdAt };
}

const CONFLICT_MESSAGES = {
  email: 'An account with this email already exists. Sign in, or use "Forgot password" if you have not set one yet.',
  school_code: 'A school with this code is already registered on SmartAttend.',
  school_name: 'A school with this name is already registered in this county.',
};

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {ReturnType<import('../mail/accountEmails.js').createAccountEmails>} opts.emails
 */
export function createSchoolsRouter({ db, emails }) {
  if (!db) throw new Error('createSchoolsRouter needs a db');
  if (!emails) throw new Error('createSchoolsRouter needs emails');
  const router = Router();

  // The application. Nobody is signed in: the applicant confirms their email
  // from the link sent now, and sets a password once the school is approved.
  router.post('/register', async (req, res, next) => {
    const { valid, errors } = validate(schoolRegistrationSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'invalid application', errors });

    const { school, applicant } = req.body;
    const { password, ...person } = applicant;
    let created;
    try {
      created = registerSchoolApplication(db, school, {
        ...person,
        ...(password ? { passwordHash: hashPassword(password) } : {}),
      });
    } catch (err) {
      if (err instanceof RegistrationConflictError) {
        return res.status(409).json({ error: CONFLICT_MESSAGES[err.field], field: err.field });
      }
      return next(err);
    }

    try {
      const { sent } = await emails.applicationConfirmation(created.user, created.school);
      res.status(201).json({ school: publicSchool(created.school), email: created.user.email, emailSent: sent });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res) => {
    const school = getSchool(db, req.params.id);
    if (!school) return res.status(404).json({ error: 'school not found' });
    res.json(publicSchool(school));
  });

  return router;
}
