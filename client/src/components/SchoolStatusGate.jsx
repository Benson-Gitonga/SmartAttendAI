import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { getSchoolStatus } from '../services/schoolService';
import { LOCAL_SCHOOL_ID } from '../db/database';
import { CapIcon, AlertTriangleIcon, SyncIcon, LogOutIcon } from './icons';

// While a school waits for approval, check again this often so the admin is
// let in soon after the system admin approves it.
const RECHECK_MS = 30_000;

const cacheKey = (schoolId) => `smartattend:school-status:${schoolId}`;
const readCached = (schoolId) => {
  try { return JSON.parse(localStorage.getItem(cacheKey(schoolId))); } catch { return null; }
};
const writeCached = (schoolId, school) => {
  try { localStorage.setItem(cacheKey(schoolId), JSON.stringify(school)); } catch { /* private mode */ }
};

/** Does this signed-in user belong to a registered school whose status matters? */
const needsSchoolCheck = (user) =>
  user?.role === 'admin' && Boolean(user.schoolId) && user.schoolId !== LOCAL_SCHOOL_ID;

/**
 * The registered school's status for a school admin: fetched from the server,
 * remembered on the device so an approved school still opens offline, and
 * re-checked while it is not active.
 */
function useSchoolStatus(schoolId) {
  const online = useOnlineStatus();
  const [school, setSchool] = useState(() => (schoolId ? readCached(schoolId) : null));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  const check = useCallback(async () => {
    if (!schoolId) return;
    setChecking(true);
    try {
      const fresh = await getSchoolStatus(schoolId);
      const next = fresh ?? { schoolId, status: 'missing' };
      setSchool(next);
      writeCached(schoolId, next);
      setError(null);
    } catch (err) {
      setError(err.message ?? 'Could not reach the server');
    } finally {
      setChecking(false);
    }
  }, [schoolId]);

  useEffect(() => { if (online) check(); }, [check, online]);

  const active = school?.status === 'active';
  useEffect(() => {
    if (active || !online) return undefined;
    const timer = setInterval(check, RECHECK_MS);
    return () => clearInterval(timer);
  }, [active, online, check]);

  return { school, checking, error, online, check };
}

const COPY = {
  pending: {
    title: 'Your school is waiting for approval',
    text: 'The SmartAttend team reviews every new school before it goes live. This page opens your dashboard by itself once the school is approved.',
  },
  rejected: {
    title: 'Your school registration was not approved',
    text: 'Read the reason below. If something was wrong, register the school again with the right details or contact SmartAttend support.',
  },
  inactive: {
    title: 'Your school has been disabled',
    text: 'SmartAttend has paused this school. Records made on your devices are kept and will be sent once the school is enabled again.',
  },
  missing: {
    title: 'We could not find your school',
    text: 'The server has no record of the school on this account. Contact SmartAttend support.',
  },
  unknown: {
    title: 'Checking your school…',
    text: 'Connect to the internet so SmartAttend can check whether your school has been approved.',
  },
};

/** Shows the dashboard to a school admin only once their school is active. */
export default function SchoolStatusGate({ children }) {
  const { user, signOut } = useAuth();
  const checkNeeded = needsSchoolCheck(user);
  const { school, checking, error, online, check } = useSchoolStatus(checkNeeded ? user.schoolId : null);

  if (!checkNeeded || school?.status === 'active') return children;

  const status = school?.status ?? 'unknown';
  const copy = COPY[status] ?? COPY.unknown;

  return (
    <div className="centered">
      <div className={`auth__card school-gate school-gate--${status}`} role="status" aria-live="polite">
        <div className="school-gate__badge">
          {status === 'pending' || status === 'unknown' ? <CapIcon size={24} /> : <AlertTriangleIcon size={24} />}
        </div>
        <h1 className="auth__brand">{copy.title}</h1>
        {school?.name && <p className="school-gate__school">{school.name}{school.county ? `, ${school.county}` : ''}</p>}
        <p className="auth__tagline">{copy.text}</p>

        {school?.reviewNote && (status === 'rejected' || status === 'inactive') && (
          <p className="school-gate__note"><b>{status === 'rejected' ? 'Reason: ' : 'Note: '}</b>{school.reviewNote}</p>
        )}
        {!online && <div className="notice notice--warn">You are offline.</div>}
        {error && online && <div className="notice notice--err">Could not check just now ({error}).</div>}

        <div className="school-gate__actions">
          {status !== 'rejected' && status !== 'missing' && (
            <button type="button" className="btn" onClick={check} disabled={checking || !online}>
              <SyncIcon size={16} /> {checking ? 'Checking…' : 'Check again'}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={signOut}>
            <LogOutIcon size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
