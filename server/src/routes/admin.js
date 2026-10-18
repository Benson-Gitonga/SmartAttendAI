/**
 * /api/admin/*: school-wide reporting and the follow-up log, for a signed-in
 * school admin of an active school. Every call is limited to the admin's own
 * school: another school's id, class or student is a 404, as if it did not
 * exist.
 */

import { Router } from 'express';
import {
  getSchoolOverview,
  getClassesForSchool,
  getClassGroup,
  getStudentsForClass,
  getFlaggedStudents,
  addFollowUp,
  getFollowUps,
  schoolIdOf,
} from '../db/repository.js';

export function createAdminRouter({ db, userAuth }) {
  if (!db) throw new Error('createAdminRouter needs a db');
  if (!userAuth) throw new Error('createAdminRouter needs userAuth');
  const router = Router();

  router.use(userAuth.requireUser('admin'), userAuth.requireActiveSchool);

  // 404 rather than 403 for another school's data, so ids cannot be probed.
  const notMine = (res, what) => res.status(404).json({ error: `${what} not found` });
  router.param('schoolId', (req, res, next, id) => (id === req.user.schoolId ? next() : notMine(res, 'school')));
  const ownsStudent = (req) => schoolIdOf(db, { studentId: req.params.id }) === req.user.schoolId;

  router.get('/schools/:schoolId/overview', (req, res) => {
    res.json(getSchoolOverview(db, req.params.schoolId));
  });

  router.get('/schools/:schoolId/classes', (req, res) => {
    res.json({ classes: getClassesForSchool(db, req.params.schoolId) });
  });

  router.get('/classes/:id/students', (req, res) => {
    const cls = getClassGroup(db, req.params.id);
    if (!cls || schoolIdOf(db, { classGroupId: req.params.id }) !== req.user.schoolId) return notMine(res, 'class');
    res.json({ class: cls, students: getStudentsForClass(db, req.params.id) });
  });

  router.get('/schools/:schoolId/flagged', (req, res) => {
    res.json({ flagged: getFlaggedStudents(db, req.params.schoolId) });
  });

  router.post('/students/:id/follow-ups', (req, res) => {
    if (!ownsStudent(req)) return notMine(res, 'student');
    const { flag, method, note } = req.body ?? {};
    if (!flag || !method) return res.status(400).json({ error: 'flag and method are required' });
    // The follow-up is logged against whoever is signed in.
    res.status(201).json(addFollowUp(db, { studentId: req.params.id, flag, method, note, actor: req.user.email }));
  });

  router.get('/students/:id/follow-ups', (req, res) => {
    if (!ownsStudent(req)) return notMine(res, 'student');
    res.json({ followUps: getFollowUps(db, req.params.id) });
  });

  return router;
}
