import { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { getMyAccount } from '../services/accountService';
import { showToast } from '../lib/toast';
import {
  CapIcon, SyncIcon, LogOutIcon, CheckCircleIcon, XCircleIcon, ClockIcon, PowerIcon, MapPinIcon, BuildingIcon,
} from './icons';

// While a school is not active, check again this often so its staff are let
// in soon after the system admin approves or enables it.
const RECHECK_MS = 30_000;
// How long the "approved" moment shows before the app opens.
const CELEBRATE_MS = 2200;

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
  const [checkedAt, setCheckedAt] = useState(null);
  const [error, setError] = useState(null);

  const check = useCallback(async () => {
    if (!enabled) return;
    setChecking(true);
    try {
      const account = await getMyAccount();
      const next = account.school ?? { status: 'missing' };
      setSchool(next);
      setCheckedAt(new Date());
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

  return { school, checking, checkedAt, error, online, check };
}

/**
 * True for a moment after the school turns active while the person watched,
 * so they see the approval instead of the page just changing under them.
 */
function useJustApproved(status) {
  const previous = useRef(status);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (status !== 'active' || !was || was === 'active') return undefined;
    setCelebrating(true);
    const timer = setTimeout(() => {
      setCelebrating(false);
      // After the app has rendered, so its toaster is listening.
      setTimeout(() => {
        showToast(was === 'inactive' ? 'Your school is enabled again' : 'Your school is approved. Welcome to SmartAttend!');
      }, 400);
    }, CELEBRATE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  return celebrating;
}

const formatDate = (sqlite) => {
  if (!sqlite) return null;
  // SQLite datetime('now') is UTC without a zone marker.
  const d = new Date(`${String(sqlite).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
};

const HEADLINE = {
  pending: {
    tone: 'pending', Icon: ClockIcon, badge: 'Pending review',
    title: 'Your application is being reviewed',
    text: 'The SmartAttend team checks every new school before it goes live. You can leave this page open: it opens your dashboard by itself as soon as the school is approved.',
  },
  active: {
    tone: 'approved', Icon: CheckCircleIcon, badge: 'Approved',
    title: 'Your school is approved!',
    text: 'Opening your dashboard…',
  },
  rejected: {
    tone: 'rejected', Icon: XCircleIcon, badge: 'Not approved',
    title: 'Your application was not approved',
    text: 'Read the reason below. If a detail was wrong, contact SmartAttend support to apply again.',
  },
  inactive: {
    tone: 'rejected', Icon: PowerIcon, badge: 'Disabled',
    title: 'Your school has been disabled',
    text: 'SmartAttend has paused this school. Records made on your devices are kept and are sent once the school is enabled again.',
  },
  missing: {
    tone: 'rejected', Icon: XCircleIcon, badge: 'Not found',
    title: 'We could not find your school',
    text: 'The server has no record of the school on this account. Contact SmartAttend support.',
  },
  unknown: {
    tone: 'pending', Icon: ClockIcon, badge: 'Checking',
    title: 'Checking your school…',
    text: 'Connect to the internet so SmartAttend can check whether your school has been approved.',
  },
};

/** The three steps of an application, as far as this school has got. */
function stepsFor(school) {
  const status = school?.status ?? 'unknown';
  const sent = { label: 'Application sent', state: 'done', date: formatDate(school?.submittedAt) };
  const reviewing = { label: 'Review by the SmartAttend team', state: 'done' };
  const decided = formatDate(school?.reviewedAt);

  if (status === 'pending' || status === 'unknown') {
    return [sent, { ...reviewing, state: 'current', detail: 'Usually within one or two working days' }, { label: 'Decision', state: 'todo' }];
  }
  if (status === 'rejected') return [sent, reviewing, { label: 'Not approved', state: 'failed', date: decided, detail: school.reviewNote }];
  if (status === 'inactive') {
    return [sent, { label: 'Approved', state: 'done' }, { label: 'Disabled by SmartAttend', state: 'failed', date: decided, detail: school.reviewNote }];
  }
  return [sent, reviewing, { label: 'Approved', state: 'done', date: decided }];
}

const STEP_ICON = { done: CheckCircleIcon, current: ClockIcon, failed: XCircleIcon };

/** Lets school staff into the app only once their school is active, and shows how the application is going until then. */
export default function SchoolStatusGate({ children }) {
  const { user, signOut } = useAuth();
  const checkNeeded = STAFF_ROLES.includes(user?.role);
  const { school, checking, checkedAt, error, online, check } = useSchoolStatus(checkNeeded);
  const celebrating = useJustApproved(school?.status);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  if (!checkNeeded || (school?.status === 'active' && !celebrating)) return children;

  const status = school?.status ?? 'unknown';
  const head = HEADLINE[status] ?? HEADLINE.unknown;
  const place = [school?.subCounty, school?.county ? `${school.county} County` : null].filter(Boolean).join(', ');
  const canRecheck = status === 'pending' || status === 'inactive' || status === 'unknown';

  return (
    <div className="ap">
      <header className="ap-header">
        <div className="sa-brand">
          <span className="sa-brand__logo"><CapIcon size={18} /></span>
          <span className="sa-brand__name">SmartAttend</span>
        </div>
        <button type="button" className="sa-btn sa-btn--ghost sa-btn--sm" onClick={() => setConfirmSignOut(true)}>
          <LogOutIcon size={16} /> Sign out
        </button>
      </header>

      <main className="ap-main">
        <section className={`ap-card ap-card--${head.tone}`} role="status" aria-live="polite">
          <div className="ap-hero">
            <span className="ap-hero__icon"><head.Icon size={28} /></span>
            <span className={`ap-badge ap-badge--${head.tone}`}><span className="ap-badge__dot" />{head.badge}</span>
            <h1 className="ap-hero__title">{head.title}</h1>
            <p className="ap-hero__text">{head.text}</p>
          </div>

          {school?.name && (
            <div className="ap-school">
              <span className="ap-school__icon"><BuildingIcon size={20} /></span>
              <span className="ap-school__text">
                <b>{school.name}</b>
                <span>
                  {place && <><MapPinIcon size={12} /> {place}</>}
                  {school.schoolCode && <span className="ap-school__code">Code {school.schoolCode}</span>}
                </span>
              </span>
            </div>
          )}

          <ol className="ap-steps" aria-label="Application progress">
            {stepsFor(school).map((step) => {
              const Icon = STEP_ICON[step.state];
              return (
                <li key={step.label} className={`ap-step ap-step--${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}>
                  <span className="ap-step__marker">{Icon ? <Icon size={16} /> : null}</span>
                  <span className="ap-step__body">
                    <span className="ap-step__label">
                      {step.label}
                      {step.date && <span className="ap-step__date">{step.date}</span>}
                    </span>
                    {step.detail && <span className="ap-step__detail">{step.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ol>

          {!online && <div className="sa-alert sa-alert--attention sa-alert--compact">You are offline. This page updates once you reconnect.</div>}
          {error && online && <div className="sa-alert sa-alert--error sa-alert--compact">Could not check just now ({error}).</div>}

          {canRecheck && !celebrating && (
            <div className="ap-footer">
              <span className="ap-footer__meta">
                {checkedAt
                  ? `Last checked ${checkedAt.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })} · checks every 30 seconds`
                  : 'Checks every 30 seconds while this page is open'}
              </span>
              <button type="button" className="sa-btn sa-btn--primary sa-btn--sm" onClick={check} disabled={checking || !online}>
                <SyncIcon size={15} className={checking ? 'sa-spin' : undefined} /> {checking ? 'Checking…' : 'Check again'}
              </button>
            </div>
          )}
        </section>
      </main>

      {confirmSignOut && (
        <ConfirmDialog
          tone="danger"
          Icon={LogOutIcon}
          title="Are you sure you want to sign out?"
          body="You can sign back in at any time to see how your application is going."
          confirmLabel="Yes, sign out"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => { setConfirmSignOut(false); signOut(); }}
        />
      )}
    </div>
  );
}
