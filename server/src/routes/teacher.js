/**
 * /api/teacher/*: what a signed-in teacher's device downloads. The school
 * admin creates classes and assigns them, so the server is where a teacher's
 * classes come from; a new phone gets them on first sign-in.
 */

import { Router } from 'express';
import { getTeacherClasses, getClassGroup, getClassAttendanceSince, todayISO } from '../db/repository.js';

// How far back a device downloads, by default: enough for the risk model's
// windows and a term's worth of reports.
const HISTORY_DAYS = 120;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function createTeacherRouter({ db, userAuth }) {
  if (!db) throw new Error('createTeacherRouter needs a db');
  if (!userAuth) throw new Error('createTeacherRouter needs userAuth');
  const router = Router();

  router.use(userAuth.requireUser('teacher'), userAuth.requireActiveSchool);

  router.get('/classes', (req, res) => {
    res.json({ classes: getTeacherClasses(db, req.user.userId) });
  });

  // The class's attendance, so a new phone has the history the at-risk list needs.
  router.get('/classes/:id/attendance', (req, res) => {
    const cls = getClassGroup(db, req.params.id);
    if (!cls || cls.teacherUserId !== req.user.userId) return res.status(404).json({ error: 'not one of your classes' });
    const since = req.query.since ?? daysAgo(HISTORY_DAYS);
    if (!ISO_DATE.test(since)) return res.status(400).json({ error: 'since must be YYYY-MM-DD' });
    res.json({ classGroupId: cls.classGroupId, since, records: getClassAttendanceSince(db, cls.classGroupId, since) });
  });

  return router;
}

function daysAgo(n) {
  const dt = new Date();
  dt.setDate(dt.getDate() - n);
  return todayISO(dt);
}
