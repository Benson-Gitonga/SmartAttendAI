/**
 * /api/schools/*: a school admin registers their school and checks whether a
 * system admin has approved it yet. No auth check yet, like the other routes.
 */

import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { schoolRegistrationSchema } from '../schemas/schoolRegistration.schema.js';
import { registerSchool, getSchool, findSchoolByName } from '../db/repository.js';

/** What a school admin is allowed to see about their own school. */
export function publicSchool(school) {
  const { schoolId, name, county, status, reviewNote, reviewedAt, createdAt } = school;
  return { schoolId, name, county, status, reviewNote, reviewedAt, createdAt };
}

export function createSchoolsRouter({ db }) {
  if (!db) throw new Error('createSchoolsRouter needs a db');
  const router = Router();

  router.post('/register', (req, res) => {
    const { valid, errors } = validate(schoolRegistrationSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'invalid registration', errors });

    const existing = findSchoolByName(db, req.body.name, req.body.county ?? null);
    // The same admin sending again (e.g. the first reply was lost) gets their
    // school back instead of a clash.
    if (existing && existing.adminEmail === req.body.adminEmail.trim().toLowerCase()) {
      return res.status(200).json(publicSchool(existing));
    }
    if (existing) {
      return res.status(409).json({
        error: 'a school with this name is already registered in this county',
        schoolId: existing.schoolId,
        status: existing.status,
      });
    }

    res.status(201).json(publicSchool(registerSchool(db, req.body)));
  });

  router.get('/:id', (req, res) => {
    const school = getSchool(db, req.params.id);
    if (!school) return res.status(404).json({ error: 'school not found' });
    res.json(publicSchool(school));
  });

  return router;
}
