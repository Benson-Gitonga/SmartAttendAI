import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { getMyAccount } from '../services/accountService';
import { CapIcon, AlertTriangleIcon, SyncIcon, LogOutIcon } from './icons';

// While a school is not active, check again this often so its staff are let
// in soon after the system admin approves or enables it.
const RECHECK_MS = 30_000;

const STAFF_ROLES = ['admin', 'teacher'];

/**
 * The signed-in person's school, as the server sees it now. Starts from what
 * the device remembers (so an approved school still opens offline), asks the
 * server whenever online, and keeps asking while the school is not active.
 */
function useSchoolStatus(enabled) {
  const { user, refreshSchool, signOut } = useAuth();
  const online = useOnlineStatus();
  const [school, setSchool] = useState(() =>
    user?.schoolStatus ? { schoolId: user.schoolId, name: user.schoolName, status: user.schoolStatus } : null
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  const check = useCallback(async () => {
    if (!enabled) return;
    setChecking(true);
    try {
      const account = await getMyAccount();
      const next = account.school ?? { status: 'missing' };
      setSchool(next);
      setError(null);
      await refreshSchool(next);
    } catch (err) {
      // Disabled or signed out on the server: the token is no good any more.
      if (err.code === 'UNAUTHORIZED') {
        signOut();
        return;
      }
      setError(err.message ?? 'Could not reach the server');
    } finally {
      setChecking(false);
    }
  }, [enabled, refreshSchool, signOut]);

  useEffect(() => { if (online) check(); }, [check, online]);

  const active = school?.status === 'active';
  useEffect(() => {
    if (!enabled || active || !online) return undefined;
    const timer = setInterval(check, RECHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, active, online, check]);

  return { school, checking, error, online, check };
}

const COPY = {
  pending: {
    title: 'Your school is waiting for approval',
    text: 'The SmartAttend team reviews every new school before it goes live. This page opens the app by itself once the school is approved.',
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

/** Lets school staff into the app only once their school is active. */
export default function SchoolStatusGate({ children }) {
  const { user, signOut } = useAuth();
  const checkNeeded = STAFF_ROLES.includes(user?.role);
  const { school, checking, error, online, check } = useSchoolStatus(checkNeeded);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

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
          <button type="button" className="btn btn--ghost" onClick={() => setConfirmSignOut(true)}>
            <LogOutIcon size={16} /> Sign out
          </button>
        </div>
      </div>

      {confirmSignOut && (
        <ConfirmDialog
          tone="danger"
          Icon={LogOutIcon}
          title="Are you sure you want to sign out?"
          body="You can sign back in at any time to check whether your school has been approved."
          confirmLabel="Yes, sign out"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => { setConfirmSignOut(false); signOut(); }}
        />
      )}
    </div>
  );
}
