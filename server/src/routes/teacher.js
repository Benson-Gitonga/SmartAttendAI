/**
 * /api/teacher/*: what a signed-in teacher's device downloads. The school
 * admin creates classes and assigns them, so the server is where a teacher's
 * classes come from; a new phone gets them on first sign-in.
 */

import { Router } from 'express';
import { getTeacherClasses } from '../db/repository.js';

export function createTeacherRouter({ db, userAuth }) {
  if (!db) throw new Error('createTeacherRouter needs a db');
  if (!userAuth) throw new Error('createTeacherRouter needs userAuth');
  const router = Router();

  router.use(userAuth.requireUser('teacher'), userAuth.requireActiveSchool);

  router.get('/classes', (req, res) => {
    res.json({ classes: getTeacherClasses(db, req.user.userId) });
  });

  return router;
}
