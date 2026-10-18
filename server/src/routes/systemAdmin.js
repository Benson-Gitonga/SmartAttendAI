/**
 * /api/system-admin/*: the platform's school list. A system admin approves or
 * rejects newly registered schools, and disables or enables approved ones.
 * No auth check yet.
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
} from '../db/repository.js';

export function createSystemAdminRouter({ db }) {
  if (!db) throw new Error('createSystemAdminRouter needs a db');
  const router = Router();

  router.get('/schools', (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !SCHOOL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${SCHOOL_STATUSES.join(', ')}` });
    }
    res.json({ schools: getAllSchools(db, { status }), counts: countSchoolsByStatus(db) });
  });

  /** Run a status change and turn its failures into HTTP answers. */
  const transition = (res, run) => {
    try {
      const school = run();
      if (!school) return res.status(404).json({ error: 'school not found' });
      res.json(school);
    } catch (err) {
      if (err instanceof SchoolTransitionError) {
        return res.status(409).json({ error: err.message, from: err.from, to: err.to });
      }
      throw err;
    }
  };

  const requireFrom = (schoolId, from, label) => {
    const current = getSchool(db, schoolId);
    if (current && from && current.status !== from) throw new SchoolTransitionError(current.status, label);
  };

  // approve / reject / disable / enable, each with an optional note and actor.
  // A rejection must say why, so the school admin knows what to fix.
  const ACTIONS = { approve: 'active', reject: 'rejected', disable: 'inactive', enable: 'active' };
  const EXPECTED_FROM = { approve: 'pending', enable: 'inactive' };

  for (const [action, status] of Object.entries(ACTIONS)) {
    router.post(`/schools/:id/${action}`, (req, res) => {
      const body = req.body ?? {};
      const { valid, errors } = validate(schoolReviewSchema, body);
      if (!valid) return res.status(400).json({ error: 'invalid request', errors });
      if (action === 'reject' && !body.note?.trim()) {
        return res.status(400).json({ error: 'give a reason for the rejection' });
      }

      transition(res, () => {
        // approve and enable both land on 'active', so check the starting
        // point too: approving a disabled school is not an approval.
        requireFrom(req.params.id, EXPECTED_FROM[action], action === 'approve' ? 'approved' : 'enabled');
        return changeSchoolStatus(db, req.params.id, status, { actor: body.actor ?? null, note: body.note });
      });
    });
  }

  // The original toggle, kept for older clients: { status: 'active' | 'inactive' }.
  router.post('/schools/:id/status', (req, res) => {
    const { status, actor = null, note = null } = req.body ?? {};
    if (status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
    }
    transition(res, () => {
      // Turning a pending school on here would skip the approval step.
      if (status === 'active') requireFrom(req.params.id, 'inactive', 'enabled');
      return setSchoolStatus(db, req.params.id, status, { actor, note });
    });
  });

  return router;
}
