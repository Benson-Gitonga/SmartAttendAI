import { chance } from '../lib/random.js';
import { scanFingerprint } from '../simulation/fingerprintSimulator.js';
import { config } from '../config.js';
import {
  findStudentByCardUid,
  recordAttendance,
  logFingerprintChallenge,
  logAudit,
  hasAttendanceForDate,
  DuplicateAttendanceError,
  todayISO,
} from '../db/repository.js';

const FINGERPRINT_RESULTS = ['match', 'no_match'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Is a device-reported scan time believable? Returns null if so, or a short
 * reason. Offline scans can arrive late, but not from the far past (a device
 * that lost its clock) or the future (a clock running fast).
 */
export function checkScanTime(
  scannedAt,
  { now = new Date(), maxAgeDays = config.offlineScanMaxAgeDays, skewMs = config.deviceClockSkewMs } = {}
) {
  if (scannedAt == null) return null;
  const at = new Date(scannedAt).getTime();
  if (Number.isNaN(at)) return 'scannedAt is not a valid time';
  if (at > now.getTime() + skewMs) return 'scannedAt is in the future; check the device clock';
  if (at < now.getTime() - maxAgeDays * DAY_MS) return `scannedAt is more than ${maxAgeDays} days old`;
  return null;
}

/**
 * Turn an RFID scan into an attendance record. Some scans (`challengeRate`)
 * also need a fingerprint match; a failed match rejects the scan.
 *
 * A gate device with a real (or Wokwi) fingerprint button sends
 * `interactive: true`. If the scan is picked for a challenge the handler
 * returns 'fingerprint-required' without writing anything, and the device
 * sends the scan again with `fingerprint: 'match' | 'no_match'`. Without
 * `interactive` the fingerprint scanner is simulated, as before.
 *
 * A scan the device queued while it could not reach the server arrives with
 * `offline: true`, its own `scannedAt` and a `scanId`. It is filed under the
 * day it happened, never challenged (the server could not ask at the time),
 * so it is recorded as an unverified card scan, and `scanId` becomes the
 * event id so a replay sent twice is recorded once.
 *
 * @returns {(scan: {cardUid: string, scanId?: string, interactive?: boolean,
 *          fingerprint?: 'match'|'no_match', offline?: boolean,
 *          scannedAt?: string, deviceId?: string}) => object}
 *          returns an outcome object instead of throwing for an unknown card,
 *          a duplicate or a rejection.
 */
export function createCardHandler({
  db,
  challengeRate = config.fingerprintChallengeRate,
  successRate = config.fingerprintSuccessRate,
} = {}) {
  if (!db) throw new Error('createCardHandler needs a db');

  return function handleCardDetected(scan) {
    const cardUid = typeof scan === 'string' ? scan : scan?.cardUid;
    const scannedAt = scan?.scannedAt ?? null;
    const date = scannedAt ? todayISO(new Date(scannedAt)) : todayISO();
    const offline = scan?.offline === true;

    const student = findStudentByCardUid(db, cardUid);
    if (!student) {
      logAudit(db, {
        action: 'rfid.unknown_card',
        recordId: cardUid,
        detail: { cardUid, scanId: scan?.scanId, offline, scannedAt, deviceId: scan?.deviceId },
      });
      return { outcome: 'unknown-card', cardUid, offline };
    }

    const reported = !offline && FINGERPRINT_RESULTS.includes(scan?.fingerprint) ? scan.fingerprint : null;

    if (scan?.interactive && !offline && !reported) {
      // Don't ask a student who already scanned in for a finger.
      if (hasAttendanceForDate(db, student.student_id, date)) {
        return { outcome: 'duplicate', student, challenged: false, fingerprint: null, date };
      }
      if (chance(challengeRate)) {
        return { outcome: 'fingerprint-required', student, date };
      }
    }

    const challenged = !offline && (reported !== null || (!scan?.interactive && chance(challengeRate)));
    let fingerprint = null;

    if (challenged) {
      fingerprint = reported
        ? { match: reported === 'match', confidence: null, source: 'device' }
        : scanFingerprint({ studentId: student.student_id, cardUid }, successRate);

      if (!fingerprint.match) {
        const challenge = logFingerprintChallenge(db, {
          studentId: student.student_id,
          cardUid,
          eventId: null,
          result: 'no_match',
          successRate,
        });
        logAudit(db, {
          action: 'attendance.rejected',
          recordId: student.student_id,
          detail: { reason: 'fingerprint_no_match', cardUid, confidence: fingerprint.confidence },
        });
        return { outcome: 'rejected', student, challenged: true, fingerprint, challenge, date };
      }
    }

    const captureMethod = challenged ? 'fingerprint' : 'rfid';

    let event;
    try {
      event = recordAttendance(db, {
        studentId: student.student_id,
        date,
        status: 'present',
        captureMethod,
        verified: challenged ? 1 : 0,
        recordedBy: null,
        source: 'simulation',
        eventId: scan?.scanId,
        createdAt: scannedAt,
      });
    } catch (err) {
      if (err instanceof DuplicateAttendanceError) {
        if (challenged) {
          logFingerprintChallenge(db, {
            studentId: student.student_id,
            cardUid,
            eventId: null,
            result: 'match',
            successRate,
          });
        }
        if (offline) logOfflineScan(db, scan, student, 'duplicate');
        return { outcome: 'duplicate', student, challenged, fingerprint, date, offline };
      }
      throw err;
    }

    if (offline) logOfflineScan(db, scan, student, 'recorded');

    let challenge = null;
    if (challenged) {
      challenge = logFingerprintChallenge(db, {
        studentId: student.student_id,
        cardUid,
        eventId: event.eventId,
        result: 'match',
        successRate,
      });
    }

    return { outcome: 'recorded', student, event, challenged, fingerprint, challenge, date, offline };
  };
}

/** Audit trail for a scan that sat in a gate device's offline queue. */
function logOfflineScan(db, scan, student, outcome) {
  const receivedAt = new Date();
  logAudit(db, {
    action: 'rfid.offline_scan',
    recordId: student.student_id,
    detail: {
      outcome,
      cardUid: scan.cardUid,
      scanId: scan.scanId,
      deviceId: scan.deviceId,
      scannedAt: scan.scannedAt,
      receivedAt: receivedAt.toISOString(),
      delaySeconds: Math.round((receivedAt.getTime() - new Date(scan.scannedAt).getTime()) / 1000),
    },
  });
}

/** One readable log line for a scan outcome, for the server terminal. */
export function describeOutcome(scan, result) {
  const who = result.student ? `${result.student.full_name} (${result.student.student_id})` : scan.cardUid;
  const late = result.offline ? ` [offline scan from ${scan.scannedAt}]` : '';
  switch (result.outcome) {
    case 'recorded':
      return (
        `${who} -> present via ${result.event.captureMethod}` +
        `${result.challenged ? ' (fingerprint verified)' : ''}${late}`
      );
    case 'duplicate':
      return `${who} -> already recorded ${result.offline ? 'that day' : 'today'}, ignored${late}`;
    case 'rejected':
      return `${who} -> REJECTED: fingerprint no-match (possible buddy punch)`;
    case 'unknown-card':
      return `unknown card ${scan.cardUid}, ignored${late}`;
    case 'fingerprint-required':
      return `${who} -> asked the gate for a fingerprint`;
    default:
      return `${who} -> ${result.outcome}`;
  }
}
