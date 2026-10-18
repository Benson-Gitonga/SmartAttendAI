/**
 * /api/admin/*: the school admin's tools, for a signed-in school admin of an
 * active school: the day's register board, classes and their teachers,
 * taking or correcting any class's register (with a reason), school-wide
 * reporting and the follow-up log. Every call is limited to the admin's own
 * school: another school's id, class or student is a 404, as if it did not
 * exist.
 */

import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { createClassSchema, updateClassSchema, registerOverrideSchema, inviteTeacherSchema } from '../schemas/admin.schema.js';
import {
  getSchoolOverview,
  getClassesForSchool,
  getClassGroup,
  getStudentsForClass,
  getFlaggedStudents,
  addFollowUp,
  getFollowUps,
  schoolIdOf,
  todayISO,
  getRegisterBoard,
  getTeachersForSchool,
  createClassGroup,
  updateClassGroup,
  getClassRegister,
  overrideRegister,
  ClassInputError,
  inviteTeacher,
  issueSetupCode,
  getSchoolTeacher,
  setTeacherEnabled,
  RegistrationConflictError,
} from '../db/repository.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createAdminRouter({ db, userAuth }) {
  if (!db) throw new Error('createAdminRouter needs a db');
  if (!userAuth) throw new Error('createAdminRouter needs userAuth');
  const router = Router();

  router.use(userAuth.requireUser('admin'), userAuth.requireActiveSchool);

  // 404 rather than 403 for another school's data, so ids cannot be probed.
  const notMine = (res, what) => res.status(404).json({ error: `${what} not found` });
  router.param('schoolId', (req, res, next, id) => (id === req.user.schoolId ? next() : notMine(res, 'school')));
  const ownsStudent = (req) => schoolIdOf(db, { studentId: req.params.id }) === req.user.schoolId;
  const ownsClass = (req) => schoolIdOf(db, { classGroupId: req.params.id }) === req.user.schoolId;

  /** ?date=YYYY-MM-DD, default today; null (and a 400 sent) when it is malformed or in the future. */
  const dateParam = (req, res, raw = req.query.date) => {
    const date = raw || todayISO();
    if (!DATE_RE.test(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return null;
    }
    if (date > todayISO()) {
      res.status(400).json({ error: 'that date has not happened yet' });
      return null;
    }
    return date;
  };

  const invalid = (res, errors) => res.status(400).json({ error: 'invalid request', errors });

  router.get('/schools/:schoolId/overview', (req, res) => {
    res.json(getSchoolOverview(db, req.params.schoolId));
  });

  // The "Today" board: every class's register for the day.
  router.get('/schools/:schoolId/today', (req, res) => {
    const date = dateParam(req, res);
    if (date) res.json(getRegisterBoard(db, req.params.schoolId, date));
  });

  router.get('/schools/:schoolId/classes', (req, res) => {
    res.json({ classes: getClassesForSchool(db, req.params.schoolId) });
  });

  // Only the school admin creates classes; teachers get the ones assigned to them.
  router.post('/schools/:schoolId/classes', (req, res) => {
    const { valid, errors } = validate(createClassSchema, req.body ?? {});
    if (!valid) return invalid(res, errors);
    try {
      const cls = createClassGroup(db, {
        ...req.body,
        schoolId: req.params.schoolId,
        academicYear: req.body.academicYear ?? new Date().getFullYear(),
        actor: req.user.email,
      });
      res.status(201).json(cls);
    } catch (err) {
      if (err instanceof ClassInputError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  router.patch('/classes/:id', (req, res) => {
    if (!ownsClass(req)) return notMine(res, 'class');
    const { valid, errors } = validate(updateClassSchema, req.body ?? {});
    if (!valid) return invalid(res, errors);
    try {
      res.json(updateClassGroup(db, req.params.id, req.body, { actor: req.user.email }));
    } catch (err) {
      if (err instanceof ClassInputError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  router.get('/schools/:schoolId/teachers', (req, res) => {
    res.json({ teachers: getTeachersForSchool(db, req.params.schoolId) });
  });

  // Invite a teacher: an account with no password yet, and a one-time code
  // the admin passes on (WhatsApp, SMS, email or paper). Shown only once.
  router.post('/schools/:schoolId/teachers', (req, res) => {
    const { valid, errors } = validate(inviteTeacherSchema, req.body ?? {});
    if (!valid) return invalid(res, errors);
    try {
      const { teacher, code, expiresAt } = inviteTeacher(db, {
        ...req.body, schoolId: req.params.schoolId, createdBy: req.user.email,
      });
      res.status(201).json({ teacher, code, expiresAt, purpose: 'invite' });
    } catch (err) {
      if (err instanceof RegistrationConflictError) {
        return res.status(409).json({ error: 'An account with this email already exists.', field: 'email' });
      }
      throw err;
    }
  });

  const teacherOr404 = (req, res) => {
    const teacher = getSchoolTeacher(db, req.user.schoolId, req.params.userId);
    if (!teacher) notMine(res, 'teacher');
    return teacher;
  };

  // A fresh code: a new invite if they never set a password, otherwise a
  // password reset. Any earlier code stops working.
  router.post('/teachers/:userId/code', (req, res) => {
    const teacher = teacherOr404(req, res);
    if (!teacher) return undefined;
    if (teacher.status === 'disabled') return res.status(409).json({ error: 'Enable this teacher first.' });
    const purpose = teacher.status === 'invited' ? 'invite' : 'reset';
    res.status(201).json({ teacher, ...issueSetupCode(db, { userId: teacher.userId, purpose, createdBy: req.user.email }) });
  });

  // Disabling signs the teacher out everywhere at once (their token is
  // re-checked on every request). Their classes stay assigned until changed.
  for (const [action, enabled] of [['disable', false], ['enable', true]]) {
    router.post(`/teachers/:userId/${action}`, (req, res) => {
      const teacher = teacherOr404(req, res);
      if (!teacher) return undefined;
      res.json(setTeacherEnabled(db, teacher.userId, enabled, { actor: req.user.email }));
    });
  }

  router.get('/classes/:id/students', (req, res) => {
    const cls = getClassGroup(db, req.params.id);
    if (!cls || !ownsClass(req)) return notMine(res, 'class');
    res.json({ class: cls, students: getStudentsForClass(db, req.params.id) });
  });

  // One class's register for a day, with any corrections already made.
  router.get('/classes/:id/register', (req, res) => {
    const cls = getClassGroup(db, req.params.id);
    if (!cls || !ownsClass(req)) return notMine(res, 'class');
    const date = dateParam(req, res);
    if (date) res.json({ class: cls, ...getClassRegister(db, req.params.id, date) });
  });

  // Take or correct the register (teacher absent, wrong mark...). Logged with
  // who, when and why, and sent to the teacher's device on its next pull.
  router.put('/classes/:id/register', (req, res) => {
    const cls = getClassGroup(db, req.params.id);
    if (!cls || !ownsClass(req)) return notMine(res, 'class');
    const { valid, errors } = validate(registerOverrideSchema, req.body ?? {});
    if (!valid) return invalid(res, errors);
    const date = dateParam(req, res, req.body.date);
    if (!date) return undefined;
    try {
      const result = overrideRegister(db, { ...req.body, classGroupId: req.params.id, actor: req.user.email });
      return res.json({ ...result, ...getClassRegister(db, req.params.id, date) });
    } catch (err) {
      if (err instanceof ClassInputError) return res.status(400).json({ error: err.message });
      throw err;
    }
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
