/**
 * POST/PATCH /api/roster/*: idempotent roster upserts pushed from the PWA by
 * a signed-in teacher or school admin. Each one may only touch their own
 * school, and only while it is active.
 */

import { Router } from 'express';
import {
  upsertSchool,
  upsertClassGroup,
  patchClassGroup,
  upsertStudent,
  patchStudent,
  upsertCard,
  schoolIdOf,
} from '../db/repository.js';

export function createRosterRouter({ db, userAuth }) {
  if (!db) throw new Error('createRosterRouter needs a db');
  if (!userAuth) throw new Error('createRosterRouter needs userAuth');
  const router = Router();

  // A school that is waiting for approval, rejected or disabled cannot change
  // its roster. 403 keeps the change queued on the device, so it goes through
  // once the school is approved or enabled again.
  router.use(userAuth.requireUser(), userAuth.requireActiveSchool);

  const require = (res, body, fields) => {
    const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
    if (missing.length > 0) {
      res.status(400).json({ error: `missing field(s): ${missing.join(', ')}` });
      return false;
    }
    return true;
  };

  // Another school's school, class or student: refused. Unknown ones pass,
  // so the usual "push the parent first" 409 still applies.
  const blocked = (res, req, { schoolId, classGroupId, studentId }) => {
    const owner = schoolId ?? schoolIdOf(db, { classGroupId, studentId });
    if (owner == null || owner === req.user.schoolId) return false;
    res.status(403).json({ error: 'that belongs to another school' });
    return true;
  };

  router.post('/schools', (req, res) => {
    const body = req.body ?? {};
    if (!require(res, body, ['schoolId', 'name'])) return;
    if (blocked(res, req, { schoolId: body.schoolId })) return;
    res.status(200).json(upsertSchool(db, body));
  });

  router.post('/classes', (req, res) => {
    const body = req.body ?? {};
    if (!require(res, body, ['classGroupId', 'schoolId', 'grade'])) return;
    if (blocked(res, req, { schoolId: body.schoolId })) return;
    try {
      res.status(200).json(upsertClassGroup(db, body));
    } catch (err) {
      if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        return res.status(409).json({ error: 'unknown schoolId - push the school first' });
      }
      throw err;
    }
  });

  router.patch('/classes/:id', (req, res) => {
    if (blocked(res, req, { classGroupId: req.params.id })) return;
    patchClassGroup(db, req.params.id, req.body ?? {});
    res.status(200).json({ classGroupId: req.params.id, updated: true });
  });

  router.post('/students', (req, res) => {
    const body = req.body ?? {};
    if (!require(res, body, ['studentId', 'classGroupId', 'fullName'])) return;
    if (blocked(res, req, { classGroupId: body.classGroupId })) return;
    try {
      res.status(200).json(upsertStudent(db, body));
    } catch (err) {
      if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        return res.status(409).json({ error: 'unknown classGroupId - push the class first' });
      }
      throw err;
    }
  });

  router.patch('/students/:id', (req, res) => {
    if (blocked(res, req, { studentId: req.params.id })) return;
    patchStudent(db, req.params.id, req.body ?? {});
    res.status(200).json({ studentId: req.params.id, updated: true });
  });

  router.post('/students/:id/card', (req, res) => {
    const body = req.body ?? {};
    if (!require(res, body, ['cardUid'])) return;
    if (blocked(res, req, { studentId: req.params.id })) return;
    try {
      res.status(200).json(upsertCard(db, { cardUid: body.cardUid, studentId: req.params.id }));
    } catch (err) {
      if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        return res.status(409).json({ error: 'unknown studentId - push the student first' });
      }
      throw err;
    }
  });

  return router;
}
