/**
 * /api/gate/* - card scans at the school gate, for any signed-in staff.
 *
 * The flow this backs: students' ID cards are scanned at the gate (POST /scan,
 * from the scan station) -> the teacher opens the PWA, which pulls today's
 * records for their class and stores them in its own IndexedDB -> the roll
 * call shows those students as already present, so the teacher only deals
 * with whoever did not scan (tick present if they forgot their card, or
 * absent + reason) and confirms. Only those changes go back up through
 * POST /api/sync.
 *
 * `gate.lastScanAt` lets the PWA tell "nobody has scanned yet" apart from
 * "the gate is down" and fall back to a full manual roll call.
 */

import { Router } from 'express';
import {
  getClassGroup,
  getClassAttendanceForDate,
  getLastGateScanAt,
  recordStationScan,
  todayISO,
  schoolIdOf,
} from '../db/repository.js';
import { validate } from '../lib/validate.js';
import { stationScanSchema } from '../schemas/admin.schema.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A station's clock may run a little fast; further ahead than this is wrong.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function createGateRouter({ db, userAuth }) {
  if (!db) throw new Error('createGateRouter needs a db');
  if (!userAuth) throw new Error('createGateRouter needs userAuth');
  const router = Router();

  router.use(userAuth.requireUser(), userAuth.requireActiveSchool);

  router.get('/classes/:id/attendance', (req, res) => {
    const date = req.query.date || todayISO();
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

    const cls = getClassGroup(db, req.params.id);
    // Another school's class looks the same as no class at all.
    if (!cls || schoolIdOf(db, { classGroupId: req.params.id }) !== req.user.schoolId) {
      return res.status(404).json({ error: 'class not found' });
    }

    res.json({
      classGroupId: req.params.id,
      date,
      gate: { lastScanAt: getLastGateScanAt(db, req.user.schoolId) },
      records: getClassAttendanceForDate(db, req.params.id, date),
    });
  });

  // A scan station: a USB barcode scanner (or a camera) at the gate or office,
  // run by any of the school's staff, reads a student's card and marks them
  // present. A station that was offline sends its saved scans later with
  // `scannedAt`, so each lands on the day it happened.
  router.post('/scan', (req, res) => {
    const { valid, errors } = validate(stationScanSchema, req.body ?? {});
    if (!valid) return res.status(400).json({ error: 'invalid scan', details: errors });
    const { cardUid, scannedAt = null } = req.body;
    if (scannedAt && new Date(scannedAt).getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
      return res.status(422).json({ error: 'scannedAt is in the future' });
    }
    const result = recordStationScan(db, req.user.schoolId, cardUid, { actor: req.user.email, scannedAt });
    res.status(result.outcome === 'unknown-card' ? 404 : 200).json(result);
  });

  return router;
}
