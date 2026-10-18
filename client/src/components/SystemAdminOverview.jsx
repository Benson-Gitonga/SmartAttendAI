import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAllSchools, approveSchool, rejectSchool, disableSchool, enableSchool,
} from '../services/systemAdminService';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { showToast } from '../lib/toast';
import ConfirmDialog from './ConfirmDialog';
import Toaster from './Toaster';
import {
  SearchIcon, PhoneIcon, MailIcon, LogOutIcon, CapIcon, ShieldIcon, BuildingIcon,
  ClockIcon, CheckCircleIcon, XCircleIcon, PowerIcon, MapPinIcon, SyncIcon, UserIcon,
  UsersIcon, ArrowRightIcon,
} from './icons';

const STATUS = {
  pending: { label: 'Waiting for approval', Icon: ClockIcon, hint: 'Need your review' },
  active: { label: 'Active', Icon: CheckCircleIcon, hint: 'Live on SmartAttend' },
  inactive: { label: 'Disabled', Icon: PowerIcon, hint: 'Paused by you' },
  rejected: { label: 'Rejected', Icon: XCircleIcon, hint: 'Not approved' },
};
const STATUS_ORDER = ['pending', 'active', 'inactive', 'rejected'];

const FILTERS = [
  { id: 'pending', label: 'Waiting' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Disabled' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

/**
 * Each status change, with the wording of its "are you sure?" dialog. `note`
 * is 'required' for a rejection (the school admin sees the reason) and
 * 'optional' when disabling.
 */
const ACTIONS = {
  approve: {
    label: 'Approve', run: approveSchool, tone: 'success', Icon: CheckCircleIcon,
    title: (s) => `Are you sure you want to approve ${s.name}?`,
    body: 'The school goes live: its admin can set up classes and teachers, and its attendance is accepted by the server.',
    confirm: 'Yes, approve',
    done: (s) => `${s.name} approved`,
  },
  reject: {
    label: 'Reject', run: rejectSchool, tone: 'danger', Icon: XCircleIcon, note: 'required',
    title: (s) => `Are you sure you want to reject ${s.name}?`,
    body: 'The school admin will see your reason. A rejected school cannot be approved later; they would have to register again.',
    noteLabel: 'Reason for rejecting',
    notePlaceholder: 'e.g. We could not confirm this school with the county education office',
    confirm: 'Yes, reject',
    done: (s) => `${s.name} rejected`,
  },
  disable: {
    label: 'Disable', run: disableSchool, tone: 'danger', Icon: PowerIcon, note: 'optional',
    title: (s) => `Are you sure you want to disable ${s.name}?`,
    body: 'Its staff will be locked out of the dashboard and the server will stop accepting its records until you enable it again. Records already on their devices are kept.',
    noteLabel: 'Reason (optional)',
    notePlaceholder: 'e.g. Subscription not renewed',
    confirm: 'Yes, disable',
    done: (s) => `${s.name} disabled`,
  },
  enable: {
    label: 'Enable', run: enableSchool, tone: 'success', Icon: PowerIcon,
    title: (s) => `Are you sure you want to enable ${s.name} again?`,
    body: 'The school goes live again, and its devices send any attendance they held while it was disabled.',
    confirm: 'Yes, enable',
    done: (s) => `${s.name} enabled`,
  },
};

const ACTIONS_FOR = {
  pending: ['reject', 'approve'],
  active: ['disable'],
  inactive: ['enable'],
  rejected: [],
};

const toDate = (sqlite) => {
  if (!sqlite) return null;
  // SQLite datetime('now') is UTC without a zone marker.
  const d = new Date(`${sqlite.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const formatDate = (sqlite) =>
  toDate(sqlite)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) ?? null;

const daysWaiting = (sqlite) => {
  const d = toDate(sqlite);
  if (!d) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? 'since today' : days === 1 ? '1 day' : `${days} days`;
};

const initials = (name = '') => {
  const words = name.replace(/\b(school|secondary|high|the|of)\b/gi, '').trim().split(/\s+/).filter(Boolean);
  const source = words.length ? words : name.trim().split(/\s+/);
  return (source.length > 1 ? source[0][0] + source[1][0] : (source[0] ?? '?').slice(0, 2)).toUpperCase();
};

const BOARDING = { day: 'Day', boarding: 'Boarding', mixed: 'Day and boarding' };
const TYPE = { public: 'Public', private: 'Private' };

/** "Public · Day and boarding · about 640 students", from whatever the school gave. */
const profileLine = (s) => [
  TYPE[s.schoolType],
  BOARDING[s.boarding],
  s.studentEstimate ? `about ${s.studentEstimate.toLocaleString('en-KE')} students` : null,
].filter(Boolean).join(' · ');

const matches = (school, query) => {
  if (!query) return true;
  const q = query.toLowerCase();
  return [school.name, school.county, school.subCounty, school.schoolCode, school.adminName, school.adminEmail]
    .some((v) => v && v.toLowerCase().includes(q));
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** System-admin home: approve or reject new schools, and disable or enable approved ones. */
export default function SystemAdminOverview() {
  const { user, signOut } = useAuth();
  const online = useOnlineStatus();

  const [schools, setSchools] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState(null); // null until the first load picks one
  const [query, setQuery] = useState('');
  const [pendingAction, setPendingAction] = useState(null); // { school, action }
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // The server's sign-in ran out: back to the sign-in screen.
  const handleError = useCallback((err) => {
    if (err?.code === 'UNAUTHORIZED') {
      showToast(err.message, { tone: 'error' });
      signOut();
      return true;
    }
    return false;
  }, [signOut]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await getAllSchools();
      setSchools(result.schools);
      setCounts(result.counts);
      setError(null);
      // Open on the approval queue when something is waiting, otherwise on all schools.
      setFilter((current) => current ?? (result.counts.pending > 0 ? 'pending' : 'all'));
    } catch (err) {
      if (!handleError(err)) setError(err.message ?? 'Could not reach the server');
    } finally {
      setRefreshing(false);
    }
  }, [handleError]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => (schools ?? []).filter((s) => (filter === 'all' || s.status === filter) && matches(s, query.trim())),
    [schools, filter, query]
  );
  const total = schools?.length ?? 0;
  const waiting = counts.pending ?? 0;

  return (
    <div className="sa">
      <header className="sa-header">
        <div className="sa-header__inner">
          <div className="sa-brand">
            <span className="sa-brand__logo"><CapIcon size={18} /></span>
            <span className="sa-brand__name">SmartAttend</span>
            <span className="sa-brand__tag"><ShieldIcon size={13} /> System admin</span>
          </div>
          <div className="sa-header__right">
            <span className={`sa-net sa-net--${online ? 'on' : 'off'}`}>
              <span className="sa-net__dot" />{online ? 'Online' : 'Offline'}
            </span>
            <span className="sa-user" title={user?.username}>
              <span className="sa-user__avatar"><UserIcon size={15} /></span>
              <span className="sa-user__name">{user?.username}</span>
            </span>
            <button
              type="button"
              className="sa-btn sa-btn--ghost sa-btn--sm"
              aria-label="Sign out"
              onClick={() => setConfirmSignOut(true)}
            >
              <LogOutIcon size={16} /> <span className="sa-hide-sm">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="sa-main">
        <section className="sa-hero">
          <div>
            <p className="sa-hero__eyebrow">{greeting()}</p>
            <h1 className="sa-hero__title">Schools on SmartAttend</h1>
            <p className="sa-hero__text">
              Review new schools before they go live, and pause any school that should stop using the platform.
            </p>
          </div>
          <button type="button" className="sa-btn sa-btn--ghost" onClick={load} disabled={refreshing}>
            <SyncIcon size={16} className={refreshing ? 'sa-spin' : undefined} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </section>

        {error && (
          <div className="sa-alert sa-alert--error" role="alert">
            <XCircleIcon size={18} />
            <span>Could not reach the server ({error}).</span>
            <button type="button" className="sa-link" onClick={load}>Try again</button>
          </div>
        )}

        {!error && schools === null && <SkeletonGrid />}

        {schools && (
          <>
            {waiting > 0 && filter !== 'pending' && (
              <div className="sa-alert sa-alert--attention">
                <ClockIcon size={18} />
                <span>
                  <b>{waiting} school{waiting === 1 ? ' is' : 's are'} waiting</b> for your review.
                </span>
                <button type="button" className="sa-link" onClick={() => setFilter('pending')}>
                  Review now <ArrowRightIcon size={14} />
                </button>
              </div>
            )}

            <div className="sa-stats">
              {STATUS_ORDER.map((status) => {
                const { label, Icon, hint } = STATUS[status];
                return (
                  <button
                    key={status}
                    type="button"
                    className={`sa-stat sa-stat--${status}`}
                    aria-pressed={filter === status}
                    onClick={() => setFilter(status)}
                  >
                    <span className="sa-stat__icon"><Icon size={20} /></span>
                    <span className="sa-stat__body">
                      <span className="sa-stat__value">{counts[status] ?? 0}</span>
                      <span className="sa-stat__label">{label}</span>
                      <span className="sa-stat__hint">{hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="sa-toolbar">
              <div className="sa-tabs" role="tablist" aria-label="Filter schools by status">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className="sa-tab"
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="sa-tab__count">{f.id === 'all' ? total : counts[f.id] ?? 0}</span>
                  </button>
                ))}
              </div>
              <label className="sa-search">
                <SearchIcon size={16} />
                <input
                  type="search"
                  placeholder="Search school, county or admin"
                  aria-label="Search schools"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>

            {visible.length > 0 ? (
              <div className="sa-grid">
                {visible.map((s) => (
                  <SchoolCard key={s.schoolId} school={s} onAction={(action) => setPendingAction({ school: s, action })} />
                ))}
              </div>
            ) : (
              <div className="sa-empty">
                <span className="sa-empty__icon"><BuildingIcon size={26} /></span>
                <p className="sa-empty__title">
                  {query.trim()
                    ? `No schools match “${query.trim()}”`
                    : filter === 'pending'
                      ? 'You are all caught up'
                      : total === 0 ? 'No schools have registered yet' : 'No schools in this list'}
                </p>
                <p className="sa-empty__text">
                  {query.trim()
                    ? 'Try another name, county or admin email.'
                    : filter === 'pending'
                      ? 'No schools are waiting for approval right now.'
                      : 'Schools appear here once their admin signs up.'}
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {pendingAction && (
        <SchoolActionDialog
          {...pendingAction}
          onUnauthorized={handleError}
          onClose={() => setPendingAction(null)}
          onDone={async () => {
            setPendingAction(null);
            await load();
          }}
        />
      )}

      {confirmSignOut && (
        <ConfirmDialog
          tone="danger"
          Icon={LogOutIcon}
          title="Are you sure you want to sign out?"
          body="You will need the system admin username and password to sign back in."
          confirmLabel="Yes, sign out"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => { setConfirmSignOut(false); signOut(); }}
        />
      )}

      <Toaster />
    </div>
  );
}

function SchoolCard({ school: s, onAction }) {
  const { label } = STATUS[s.status] ?? { label: s.status };
  const reviewed = formatDate(s.reviewedAt);
  const approvedOrPaused = s.status === 'active' || s.status === 'inactive';

  return (
    <article className={`sa-card sa-card--${s.status}`}>
      <header className="sa-card__head">
        <span className="sa-card__avatar" aria-hidden="true">{initials(s.name)}</span>
        <div className="sa-card__id">
          <h3 className="sa-card__name">{s.name}</h3>
          <p className="sa-card__place">
            <MapPinIcon size={13} /> {[s.subCounty, s.county ? `${s.county} County` : null].filter(Boolean).join(', ') || 'No county given'}
          </p>
        </div>
        <span className={`sa-badge sa-badge--${s.status}`}><span className="sa-badge__dot" />{label}</span>
      </header>

      <dl className="sa-card__facts">
        {(s.schoolCode || profileLine(s)) && (
          <div>
            <dt><BuildingIcon size={14} /> School</dt>
            <dd>
              {s.schoolCode && <span className="sa-card__code">Code {s.schoolCode}</span>}
              {s.schoolCode && profileLine(s) && ' · '}
              {profileLine(s)}
            </dd>
          </div>
        )}
        <div>
          <dt><UserIcon size={14} /> Admin</dt>
          <dd>{s.adminName || 'Not recorded'}</dd>
        </div>
        {s.adminEmail && (
          <div>
            <dt><MailIcon size={14} /> Email</dt>
            <dd><a href={`mailto:${s.adminEmail}`}>{s.adminEmail}</a></dd>
          </div>
        )}
        {s.adminPhone && (
          <div>
            <dt><PhoneIcon size={14} /> Phone</dt>
            <dd><a href={`tel:${s.adminPhone}`}>{s.adminPhone}</a></dd>
          </div>
        )}
        {approvedOrPaused ? (
          <div>
            <dt><UsersIcon size={14} /> Size</dt>
            <dd>
              {s.classCount} class{s.classCount === 1 ? '' : 'es'} · {s.studentCount} student{s.studentCount === 1 ? '' : 's'}
            </dd>
          </div>
        ) : (
          <div>
            <dt><ClockIcon size={14} /> Registered</dt>
            <dd>
              {formatDate(s.createdAt) ?? '-'}
              {s.status === 'pending' && daysWaiting(s.createdAt) && (
                <span className="sa-card__waiting"> · waiting {daysWaiting(s.createdAt)}</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {s.reviewNote && (
        <p className={`sa-card__note sa-card__note--${s.status}`}>
          <b>{s.status === 'rejected' ? 'Reason' : 'Note'}:</b> {s.reviewNote}
        </p>
      )}

      <footer className="sa-card__foot">
        <span className="sa-card__meta">
          {reviewed && s.status !== 'pending'
            ? `${label} ${reviewed}${s.reviewedBy ? ` by ${s.reviewedBy}` : ''}`
            : s.status === 'pending' ? 'New registration' : ''}
        </span>
        {ACTIONS_FOR[s.status]?.length > 0 && (
          <span className="sa-card__actions">
            {ACTIONS_FOR[s.status].map((action) => {
              const { label: text, tone, Icon } = ACTIONS[action];
              const variant = action === 'reject' ? 'danger-outline' : tone;
              return (
                <button key={action} type="button" className={`sa-btn sa-btn--sm sa-btn--${variant}`} onClick={() => onAction(action)}>
                  <Icon size={15} /> {text}
                </button>
              );
            })}
          </span>
        )}
      </footer>
    </article>
  );
}

/** "Are you sure?" for one status change, with a reason box where one is wanted. */
function SchoolActionDialog({ school, action, onUnauthorized, onClose, onDone }) {
  const spec = ACTIONS[action];
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await spec.run(school.schoolId, { note });
      showToast(spec.done(school));
      await onDone();
    } catch (err) {
      if (onUnauthorized(err)) return;
      setError(err.message ?? 'Could not save this change');
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      tone={spec.tone}
      Icon={spec.Icon}
      title={spec.title(school)}
      body={spec.body}
      confirmLabel={spec.confirm}
      busy={busy}
      error={error}
      confirmDisabled={spec.note === 'required' && !note.trim()}
      onCancel={onClose}
      onConfirm={confirm}
    >
      {spec.note && (
        <div className="sa-field">
          <label className="sa-field__label" htmlFor="school-note">{spec.noteLabel}</label>
          <textarea
            id="school-note"
            className="sa-field__input"
            rows={3}
            maxLength={500}
            placeholder={spec.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
      )}
    </ConfirmDialog>
  );
}

function SkeletonGrid() {
  return (
    <div role="status">
      <div className="sa-stats">
        {STATUS_ORDER.map((s) => <div key={s} className="sa-stat sa-skeleton" />)}
      </div>
      <div className="sa-grid sa-grid--loading">
        {[0, 1, 2, 3].map((i) => <div key={i} className="sa-card sa-skeleton sa-skeleton--card" />)}
      </div>
      <span className="sa-visually-hidden">Loading schools…</span>
    </div>
  );
}
