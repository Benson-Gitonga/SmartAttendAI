import express from 'express';
import morgan from 'morgan';
import { timingSafeEqual } from 'node:crypto';
import { createCardHandler, checkScanTime, describeOutcome } from './attendance/handler.js';
import { rfidScanSchema } from './schemas/rfidScan.schema.js';
import { validate } from './lib/validate.js';
import { config } from './config.js';
import { createSyncRouter } from './routes/sync.js';
import { createRosterRouter } from './routes/roster.js';
import { createAdminRouter } from './routes/admin.js';
import { createSystemAdminRouter } from './routes/systemAdmin.js';
import { createSchoolsRouter } from './routes/schools.js';
import { createGateRouter } from './routes/gate.js';
import { createSystemAdminAuth } from './auth/systemAdminAuth.js';
import { createUserAuth } from './auth/userAuth.js';
import { createAuthRouter } from './routes/auth.js';
import { createTeacherRouter } from './routes/teacher.js';
import { createMailer } from './mail/mailer.js';
import { createAccountEmails } from './mail/accountEmails.js';
import {
  getAttendanceForDate,
  getRecentChallenges,
  getStats,
  countPendingSync,
  todayISO,
} from './db/repository.js';

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {ReturnType<typeof createCardHandler>} [opts.cardHandler]
 * @param {string} [opts.deviceApiKey] required X-Device-Key for gate scans; '' = open
 * @param {ReturnType<typeof createSystemAdminAuth>} [opts.systemAdminAuth] sign-in for /api/system-admin
 * @param {ReturnType<typeof createUserAuth>} [opts.userAuth] sign-in for school staff
 * @param {ReturnType<typeof createMailer>} [opts.mailer] outgoing email (log-only by default)
 * @param {string} [opts.appUrl] where the PWA lives, for links in emails
 */
export function createApp({
  db,
  cardHandler = createCardHandler({ db }),
  logger = true,
  deviceApiKey = config.deviceApiKey,
  systemAdminAuth = createSystemAdminAuth(config.systemAdmin),
  userAuth = createUserAuth({ db, ...config.auth }),
  mailer = createMailer(config.mail),
  appUrl = config.appUrl,
} = {}) {
  const app = express();
  const emails = createAccountEmails({ db, mailer, appUrl });
  app.use(express.json());
  if (logger) app.use(morgan('dev'));

  app.get('/health', (req, res) => {
    const tables = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get().n;
    res.json({ status: 'ok', uptime: process.uptime(), tables, pendingSync: countPendingSync(db) });
  });

  // Platform-wide debugging views over every school: system admin only.
  const platformOnly = systemAdminAuth.requireSystemAdmin;

  app.get('/api/students', platformOnly, (req, res) => {
    res.json(db.prepare('SELECT * FROM students ORDER BY full_name').all());
  });

  app.get('/api/attendance', platformOnly, (req, res) => {
    const date = req.query.date || todayISO();
    res.json({ date, records: getAttendanceForDate(db, date) });
  });

  app.get('/api/challenges', platformOnly, (req, res) => {
    res.json({ challenges: getRecentChallenges(db, Number(req.query.limit) || 50) });
  });

  app.get('/api/stats', platformOnly, (req, res) => {
    res.json(getStats(db, req.query.date || todayISO()));
  });

  app.use('/api/auth', createAuthRouter({ db, userAuth, emails }));

  // Without SES, emails only go to the console and this outbox, so the links
  // in them can still be followed while developing.
  if (mailer.transport === 'log' && process.env.NODE_ENV !== 'production') {
    app.get('/api/dev/outbox', (req, res) => res.json({ emails: mailer.outbox() }));
  }

  app.use('/api/sync', createSyncRouter({ db, userAuth }));

  app.use('/api/roster', createRosterRouter({ db, userAuth }));
  app.use('/api/admin', createAdminRouter({ db, userAuth, emails }));
  app.use('/api/teacher', createTeacherRouter({ db, userAuth }));

  // Today's gate scans (and any teacher marks) for one class, pulled by the
  // PWA before roll call so the teacher only handles students who didn't scan.
  app.use('/api/gate', createGateRouter({ db, userAuth }));

  // A school applies to join, and its applicant waits for approval.
  app.use('/api/schools', createSchoolsRouter({ db, emails }));

  // Platform-wide school list: approve or reject new schools, disable or
  // enable approved ones. For the system-admin role.
  app.use('/api/system-admin', createSystemAdminRouter({ db, auth: systemAdminAuth, emails }));

  // One scan from a gate device or by hand. Body: { "cardUid": "04A1B2C3" }
  // plus, for a device with a fingerprint step, "interactive": true and later
  // "fingerprint": "match" | "no_match", and for a scan replayed from the
  // device's offline queue "offline", "scannedAt" and "scanId".
  // See attendance/handler.js and schemas/rfidScan.schema.js.
  app.post('/api/rfid/scan', requireDeviceKey(deviceApiKey), (req, res) => {
    const { valid, errors } = validate(rfidScanSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'invalid scan', errors });

    const timeProblem = checkScanTime(req.body.scannedAt);
    if (timeProblem) return res.status(422).json({ error: timeProblem });

    const scan = { ...req.body, cardUid: req.body.cardUid.toUpperCase() };
    const result = cardHandler(scan);
    if (logger) console.log(`[gate] ${describeOutcome(scan, result)}`);

    const status = result.outcome === 'unknown-card' ? 404 : 200;
    res.status(status).json(result);
  });

  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

/** Gate devices prove who they are with a shared key. An empty key turns the check off. */
function requireDeviceKey(expected) {
  const want = Buffer.from(expected);
  return (req, res, next) => {
    if (!expected) return next();
    const got = Buffer.from(req.get('x-device-key') ?? '');
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      return res.status(401).json({ error: 'missing or wrong X-Device-Key' });
    }
    next();
  };
}
