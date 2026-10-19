/**
 * /api/schools/*: a school applies to join SmartAttend, and anyone can look
 * up a school's status (name, status and review note only).
 */

import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { schoolRegistrationSchema } from '../schemas/schoolRegistration.schema.js';
import { registerSchoolApplication, getSchool, RegistrationConflictError } from '../db/repository.js';
import { hashPassword } from '../auth/systemAdminAuth.js';
import { describeAccount } from '../auth/userAuth.js';

/** What anyone may see about a school. */
export function publicSchool(school) {
  const { schoolId, name, county, status, reviewNote, reviewedAt, createdAt } = school;
  return { schoolId, name, county, status, reviewNote, reviewedAt, createdAt };
}

const CONFLICT_MESSAGES = {
  email: 'An account with this email already exists. Sign in instead.',
  school_code: 'A school with this code is already registered on SmartAttend.',
  school_name: 'A school with this name is already registered in this county.',
};

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {ReturnType<import('../auth/userAuth.js').createUserAuth>} opts.userAuth
 */
export function createSchoolsRouter({ db, userAuth }) {
  if (!db) throw new Error('createSchoolsRouter needs a db');
  if (!userAuth) throw new Error('createSchoolsRouter needs userAuth');
  const router = Router();

  // The application. The applicant is signed in straight away (as the
  // school's admin) so they can follow the review from the app.
  router.post('/register', (req, res) => {
    const { valid, errors } = validate(schoolRegistrationSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'invalid application', errors });

    const { school, applicant } = req.body;
    const { password, ...person } = applicant;
    try {
      const { user } = registerSchoolApplication(db, school, { ...person, passwordHash: hashPassword(password) });
      res.status(201).json({ ...userAuth.issueToken(user), ...describeAccount(db, user) });
    } catch (err) {
      if (err instanceof RegistrationConflictError) {
        return res.status(409).json({ error: CONFLICT_MESSAGES[err.field], field: err.field });
      }
      throw err;
    }
  });

  router.get('/:id', (req, res) => {
    const school = getSchool(db, req.params.id);
    if (!school) return res.status(404).json({ error: 'school not found' });
    res.json(publicSchool(school));
  });

  return router;
}
