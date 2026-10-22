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
  SearchIcon, LogOutIcon, CheckCircleIcon, XCircleIcon, PowerIcon, SyncIcon,
} from './icons';

const STATUS_LABEL = {
  pending: 'Pending review',
  active: 'Active',
  inactive: 'Disabled',
  rejected: 'Rejected',
};

const FILTERS = [
  { id: 'pending', label: 'Pending review' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Disabled' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All schools' },
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
    body: 'The school admin will see your reason.',
    noteLabel: 'Reason for rejecting',
    notePlaceholder: 'e.g. We could not confirm this school with the county education office',
    confirm: 'Yes, reject',
    done: (s) => `${s.name} rejected`,
  },
  disable: {
    label: 'Disable', run: disableSchool, tone: 'danger', Icon: PowerIcon, note: 'optional',
    title: (s) => `Are you sure you want to disable ${s.name}?`,
    body: 'Its staff will be signed out until you enable it again.',
    noteLabel: 'Reason (optional)',
    notePlaceholder: 'e.g. Subscription not renewed',
    confirm: 'Yes, disable',
    done: (s) => `${s.name} disabled`,
  },
  enable: {
    label: 'Enable', run: enableSchool, tone: 'success', Icon: PowerIcon,
    title: (s) => `Are you sure you want to enable ${s.name} again?`,
    body: 'Its staff can sign in again.',
    confirm: 'Yes, enable',
    done: (s) => `${s.name} enabled`,
  },
};

// Order matters: the last one is the primary button.
const ACTIONS_FOR = {
  pending: ['reject', 'approve'],
  active: ['disable'],
  inactive: ['enable'],
  rejected: [],
};

// Button look per action: approve is the one primary action, the rest are secondary.
const BUTTON_FOR = {
  approve: 'primary',
  reject: 'secondary',
  disable: 'danger',
  enable: 'secondary',
};

const toDate = (sqlite) => {
  if (!sqlite) return null;
  // SQLite datetime('now') is UTC without a zone marker.
  const d = new Date(`${sqlite.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const formatDate = (sqlite) =>
  toDate(sqlite)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) ?? null;

const ageOf = (sqlite) => {
  const d = toDate(sqlite);
  if (!d) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
};

const BOARDING = { day: 'Day', boarding: 'Boarding', mixed: 'Day and boarding' };
const TYPE = { public: 'Public', private: 'Private' };

const place = (s) => [s.subCounty, s.county].filter(Boolean).join(', ');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const matches = (school, query) => {
  if (!query) return true;
  const q = query.toLowerCase();
  return [school.name, school.county, school.subCounty, school.schoolCode, school.adminName, school.adminEmail]
    .some((v) => v && v.toLowerCase().includes(q));
};

/** System-admin console: approve or reject new schools, and disable or enable approved ones. */
export default function SystemAdminOverview() {
  const { user, signOut } = useAuth();
  const online = useOnlineStatus();

  const [schools, setSchools] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState(null); // null until the first load picks one
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null); // school shown in the side panel
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
      // Open on the review queue when something is waiting, otherwise on all schools.
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
  const openSchool = schools?.find((s) => s.schoolId === openId) ?? null;
  const ask = (school, action) => setPendingAction({ school, action });

  return (
    <div className="sys">
      <header className="sys-top">
        <div className="sys-top__brand">
          SmartAttend <span className="sys-top__product">Admin console</span>
        </div>
        <div className="sys-top__right">
          {!online && <span className="sys-top__offline">Offline</span>}
          <span className="sys-top__user" title={user?.username}>{user?.username}</span>
          <button type="button" className="sys-top__signout" aria-label="Sign out" onClick={() => setConfirmSignOut(true)}>
            <LogOutIcon size={15} /> <span className="sys-hide-sm">Sign out</span>
          </button>
        </div>
      </header>

      <main className="sys-main">
        <div className="sys-pagehead">
          <div>
            <h1 className="sys-pagehead__title">Schools</h1>
            {schools && (
              <p className="sys-pagehead__sub">
                {plural(total, 'school')} registered
                {waiting > 0 && <> · <b>{waiting} pending review</b></>}
              </p>
            )}
          </div>
          <button type="button" className="sys-btn sys-btn--secondary" onClick={load} disabled={refreshing}>
            <SyncIcon size={14} className={refreshing ? 'sa-spin' : undefined} /> Refresh
          </button>
        </div>

        {error && (
          <div className="sys-banner sys-banner--error" role="alert">
            Could not reach the server ({error}).{' '}
            <button type="button" className="sys-linkbtn" onClick={load}>Try again</button>
          </div>
        )}

        <nav className="sys-tabs" role="tablist" aria-label="Filter schools by status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className="sys-tab"
              onClick={() => setFilter(f.id)}
              disabled={!schools}
            >
              {f.label}
              <span className="sys-tab__count">{f.id === 'all' ? total : counts[f.id] ?? 0}</span>
            </button>
          ))}
        </nav>

        <section className="sys-panel">
          <div className="sys-toolbar">
            <label className="sys-search">
              <SearchIcon size={14} />
              <input
                type="search"
                placeholder="Search by school, county, code or admin"
                aria-label="Search schools"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {schools && <span className="sys-toolbar__count">{plural(visible.length, 'result')}</span>}
          </div>

          <table className="sys-table">
            <thead>
              <tr>
                <th>School</th>
                <th>Location</th>
                <th>Administrator</th>
                <th>Registered</th>
                <th>Status</th>
                <th className="sys-table__actions"><span className="sa-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {!schools && !error && (
                <tr><td colSpan={6} className="sys-table__empty" role="status">Loading schools…</td></tr>
              )}
              {schools && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="sys-table__empty">
                    {query.trim()
                      ? `No schools match “${query.trim()}”.`
                      : filter === 'pending'
                        ? 'No schools are waiting for review.'
                        : total === 0 ? 'No schools have registered yet.' : 'No schools with this status.'}
                  </td>
                </tr>
              )}
              {visible.map((s) => (
                <SchoolRow
                  key={s.schoolId}
                  school={s}
                  selected={s.schoolId === openId}
                  onOpen={() => setOpenId(s.schoolId)}
                  onAction={(action) => ask(s, action)}
                />
              ))}
            </tbody>
          </table>
        </section>
      </main>

      {openSchool && (
        <SchoolPanel school={openSchool} onClose={() => setOpenId(null)} onAction={(action) => ask(openSchool, action)} />
      )}

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

function StatusLabel({ school }) {
  // A new application waits for the applicant to confirm their email first.
  if (school.status === 'pending' && school.adminEmailVerified === false) {
    return <span className="sys-status sys-status--unconfirmed">Email not confirmed</span>;
  }
  return <span className={`sys-status sys-status--${school.status}`}>{STATUS_LABEL[school.status] ?? school.status}</span>;
}

function ActionButtons({ school, onAction }) {
  const actions = ACTIONS_FOR[school.status] ?? [];
  if (actions.length === 0) return null;
  // Approval waits until the applicant has confirmed their email.
  const waitingForEmail = school.status === 'pending' && school.adminEmailVerified === false;
  return actions.map((action) => (
    <button
      key={action}
      type="button"
      className={`sys-btn sys-btn--sm sys-btn--${BUTTON_FOR[action]}`}
      disabled={action === 'approve' && waitingForEmail}
      title={action === 'approve' && waitingForEmail ? 'The applicant has not confirmed their email yet' : undefined}
      onClick={(e) => { e.stopPropagation(); onAction(action); }}
    >
      {ACTIONS[action].label}
    </button>
  ));
}

function SchoolRow({ school: s, selected, onOpen, onAction }) {
  const live = s.status === 'active' || s.status === 'inactive';
  const sub = [s.schoolCode && `Code ${s.schoolCode}`, live && `${plural(s.classCount ?? 0, 'class')}, ${plural(s.studentCount ?? 0, 'student')}`]
    .filter(Boolean).join(' · ');
  return (
    <tr className={selected ? 'is-selected' : undefined} onClick={onOpen}>
      <td data-label="School">
        <button type="button" className="sys-table__name" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          {s.name}
        </button>
        {sub && <div className="sys-table__sub">{sub}</div>}
      </td>
      <td data-label="Location">{place(s) || <span className="sys-muted">Not given</span>}</td>
      <td data-label="Administrator">
        {s.adminName || <span className="sys-muted">Not recorded</span>}
        {s.adminEmail && <div className="sys-table__sub">{s.adminEmail}</div>}
      </td>
      <td data-label="Registered" className="sys-nowrap">
        {formatDate(s.createdAt) ?? '-'}
        {s.status === 'pending' && ageOf(s.createdAt) && <div className="sys-table__sub">{ageOf(s.createdAt)}</div>}
      </td>
      <td data-label="Status">
        <StatusLabel school={s} />
        {s.reviewNote && <div className="sys-table__sub sys-table__note" title={s.reviewNote}>{s.reviewNote}</div>}
      </td>
      <td className="sys-table__actions">
        <ActionButtons school={s} onAction={onAction} />
      </td>
    </tr>
  );
}

/** Side panel with everything the school sent, its review history and the actions. */
function SchoolPanel({ school: s, onClose, onAction }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = [
    ['School code', s.schoolCode],
    ['Type', TYPE[s.schoolType]],
    ['Boarding', BOARDING[s.boarding]],
    ['Students (estimate)', s.studentEstimate?.toLocaleString('en-KE')],
    ['County', s.county],
    ['Sub-county', s.subCounty],
  ];
  const contact = [
    ['Name', s.adminName],
    ['Email', s.adminEmail && <a href={`mailto:${s.adminEmail}`}>{s.adminEmail}</a>],
    ['Phone', s.adminPhone && <a href={`tel:${s.adminPhone}`}>{s.adminPhone}</a>],
  ];
  const live = s.status === 'active' || s.status === 'inactive';

  return (
    <>
      <div className="sys-drawer-backdrop" onClick={onClose} role="presentation" />
      <aside className="sys-drawer" aria-label={`${s.name} details`}>
        <header className="sys-drawer__head">
          <div>
            <h2 className="sys-drawer__title">{s.name}</h2>
            <StatusLabel school={s} />
          </div>
          <button type="button" className="sys-drawer__close" aria-label="Close details" onClick={onClose}>×</button>
        </header>

        <div className="sys-drawer__body">
          <DetailList title="School" rows={rows} />
          <DetailList title="Administrator" rows={contact} />
          {live && (
            <DetailList
              title="Usage"
              rows={[['Classes', String(s.classCount ?? 0)], ['Students enrolled', String(s.studentCount ?? 0)]]}
            />
          )}
          <DetailList
            title="History"
            rows={[
              ['Registered', formatDate(s.createdAt)],
              s.reviewedAt && s.status !== 'pending' && [
                `${STATUS_LABEL[s.status]} on`,
                `${formatDate(s.reviewedAt)}${s.reviewedBy ? ` by ${s.reviewedBy}` : ''}`,
              ],
              s.reviewNote && [s.status === 'rejected' ? 'Reason' : 'Note', s.reviewNote],
            ].filter(Boolean)}
          />
        </div>

        {ACTIONS_FOR[s.status]?.length > 0 && (
          <footer className="sys-drawer__foot">
            <ActionButtons school={s} onAction={onAction} />
          </footer>
        )}
      </aside>
    </>
  );
}

/** Label/value rows; anything the school left blank is left out. */
function DetailList({ title, rows }) {
  const filled = rows.filter(([, value]) => value);
  if (filled.length === 0) return null;
  return (
    <section className="sys-detail">
      <h3 className="sys-detail__title">{title}</h3>
      <dl>
        {filled.map(([label, value]) => (
          <div key={label} className="sys-detail__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
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
