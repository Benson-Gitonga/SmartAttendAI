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
 * @returns {(scan: {cardUid: string, scanId?: string, interactive?: boolean,
 *          fingerprint?: 'match'|'no_match'}) => object}
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
    const date = todayISO();

    const student = findStudentByCardUid(db, cardUid);
    if (!student) {
      logAudit(db, { action: 'rfid.unknown_card', recordId: cardUid, detail: { cardUid, scanId: scan?.scanId } });
      return { outcome: 'unknown-card', cardUid };
    }

    const reported = FINGERPRINT_RESULTS.includes(scan?.fingerprint) ? scan.fingerprint : null;

    if (scan?.interactive && !reported) {
      // Don't ask a student who already scanned in for a finger.
      if (hasAttendanceForDate(db, student.student_id, date)) {
        return { outcome: 'duplicate', student, challenged: false, fingerprint: null, date };
      }
      if (chance(challengeRate)) {
        return { outcome: 'fingerprint-required', student, date };
      }
    }

    const challenged = reported !== null || (!scan?.interactive && chance(challengeRate));
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
        return { outcome: 'duplicate', student, challenged, fingerprint, date };
      }
      throw err;
    }

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

    return { outcome: 'recorded', student, event, challenged, fingerprint, challenge, date };
  };
}
