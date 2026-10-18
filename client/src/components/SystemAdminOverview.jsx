import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAllSchools, approveSchool, rejectSchool, disableSchool, enableSchool,
} from '../services/systemAdminService';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { showToast } from '../lib/toast';
import TopBar from './TopBar';
import { SearchIcon, PhoneIcon, MailIcon, LogOutIcon } from './icons';

const STATUS_LABEL = {
  pending: 'Waiting for approval',
  active: 'Active',
  inactive: 'Disabled',
  rejected: 'Rejected',
};
const STATUS_PILL = { pending: 'late', active: 'present', inactive: 'absent', rejected: 'unmarked' };

const FILTERS = [
  { id: 'pending', label: 'Waiting' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Disabled' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

/**
 * What each button does, and what the confirmation sheet says. `note` is
 * 'required' for a rejection (the school admin is shown the reason), and
 * 'optional' when disabling.
 */
const ACTIONS = {
  approve: {
    label: 'Approve', run: approveSchool, tone: 'btn',
    title: (s) => `Approve ${s.name}?`,
    body: 'The school admin can start setting up classes and teachers, and the school’s attendance will be accepted by the server.',
    done: (s) => `${s.name} approved`,
  },
  reject: {
    label: 'Reject', run: rejectSchool, tone: 'btn btn--danger', note: 'required',
    title: (s) => `Reject ${s.name}?`,
    body: 'The school admin will see your reason. A rejected school cannot be approved later; they would need to register again.',
    noteLabel: 'Reason for rejecting',
    notePlaceholder: 'e.g. We could not confirm this school with the county education office',
    done: (s) => `${s.name} rejected`,
  },
  disable: {
    label: 'Disable', run: disableSchool, tone: 'btn btn--danger', note: 'optional',
    title: (s) => `Disable ${s.name}?`,
    body: 'Its staff can still open the app, but nothing they record reaches the server until you enable the school again. Their records wait on their devices.',
    noteLabel: 'Reason (optional)',
    notePlaceholder: 'e.g. Subscription not renewed',
    done: (s) => `${s.name} disabled`,
  },
  enable: {
    label: 'Enable', run: enableSchool, tone: 'btn',
    title: (s) => `Enable ${s.name} again?`,
    body: 'The school’s devices will send any attendance they held while it was disabled.',
    done: (s) => `${s.name} enabled`,
  },
};

/** Which actions a school in each status offers. */
const ACTIONS_FOR = {
  pending: ['approve', 'reject'],
  active: ['disable'],
  inactive: ['enable'],
  rejected: [],
};

const formatDate = (sqlite) => {
  if (!sqlite) return null;
  // SQLite datetime('now') is UTC without a zone marker.
  const d = new Date(`${sqlite.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime())
    ? sqlite
    : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
};

const matches = (school, query) => {
  if (!query) return true;
  const q = query.toLowerCase();
  return [school.name, school.county, school.adminName, school.adminEmail]
    .some((v) => v && v.toLowerCase().includes(q));
};

/** System-admin home: approve or reject newly registered schools, and disable or enable approved ones. */
export default function SystemAdminOverview() {
  const { user, signOut } = useAuth();
  const signedInAs = user?.username;
  const online = useOnlineStatus();

  const [schools, setSchools] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null); // null until the first load picks one
  const [query, setQuery] = useState('');
  const [pendingAction, setPendingAction] = useState(null); // { school, action }

  // The server's sign-in ran out (or the server restarted without a fixed
  // token secret): back to the sign-in screen.
  const handleError = useCallback((err) => {
    if (err?.code === 'UNAUTHORIZED') {
      showToast(err.message, { tone: 'error' });
      signOut();
      return true;
    }
    return false;
  }, [signOut]);

  const load = useCallback(async () => {
    try {
      const result = await getAllSchools();
      setSchools(result.schools);
      setCounts(result.counts);
      setError(null);
      // Open on the approval queue when something is waiting, otherwise on all schools.
      setFilter((current) => current ?? (result.counts.pending > 0 ? 'pending' : 'all'));
    } catch (err) {
      if (!handleError(err)) setError(err.message ?? 'Could not reach the server');
    }
  }, [handleError]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => (schools ?? []).filter((s) => (filter === 'all' || s.status === filter) && matches(s, query.trim())),
    [schools, filter, query]
  );
  const total = schools?.length ?? 0;

  return (
    <div className="app">
      <TopBar crumbs={[{ label: 'Schools' }]} online={online} />
      <div className="app__scroll">
        <div className="page-head">
          <h2 className="page-head__title">Schools on SmartAttend</h2>
        </div>
        <p className="card__hint" style={{ marginTop: 4 }}>
          {signedInAs && <>Signed in as <b>{signedInAs}</b>. </>}
          New schools wait here until you approve them. Disabling a school stops the
          server accepting its records until you enable it again.
        </p>

        {error && (
          <div className="notice notice--err" role="alert">
            Could not reach the server ({error}).{' '}
            <button type="button" className="linkbtn" onClick={load}>Try again</button>
          </div>
        )}
        {!error && schools === null && <p className="empty">Loading schools…</p>}

        {schools && (
          <>
            <div className="admin-stats school-stats">
              {['pending', 'active', 'inactive', 'rejected'].map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`stat-card stat-card--button${status === 'pending' && counts.pending > 0 ? ' stat-card--attention' : ''}`}
                  aria-pressed={filter === status}
                  onClick={() => setFilter(status)}
                >
                  <div className="stat-card__value">{counts[status] ?? 0}</div>
                  <div className="stat-card__label">{STATUS_LABEL[status]}</div>
                </button>
              ))}
            </div>

            <div className="school-toolbar">
              <div className="chips" role="tablist" aria-label="Filter schools by status">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className="chip"
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="chip__count">{f.id === 'all' ? total : counts[f.id] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="search">
                <SearchIcon size={16} />
                <input
                  type="search"
                  placeholder="Search school, county or admin"
                  aria-label="Search schools"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="school-list">
              {visible.map((s) => (
                <SchoolCard key={s.schoolId} school={s} onAction={(action) => setPendingAction({ school: s, action })} />
              ))}
              {visible.length === 0 && (
                <p className="empty">
                  {query.trim()
                    ? `No schools match “${query.trim()}”.`
                    : filter === 'pending'
                      ? 'No schools are waiting for approval.'
                      : total === 0 ? 'No schools have registered yet.' : 'No schools in this list.'}
                </p>
              )}
            </div>
          </>
        )}

        <button type="button" className="btn btn--sm btn--ghost" style={{ marginTop: 20 }} onClick={signOut}>
          <LogOutIcon size={16} /> Sign out
        </button>
      </div>

      {pendingAction && (
        <ConfirmSchoolAction
          {...pendingAction}
          onUnauthorized={handleError}
          onClose={() => setPendingAction(null)}
          onDone={async () => {
            setPendingAction(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function SchoolCard({ school: s, onAction }) {
  const registered = formatDate(s.createdAt);
  const reviewed = formatDate(s.reviewedAt);
  return (
    <article className={`school-card school-card--${s.status}`}>
      <div className="school-card__head">
        <div className="school-card__id">
          <div className="school-card__name">{s.name}</div>
          <div className="school-card__meta">
            {s.county ? `${s.county} County` : 'No county given'}
            {registered && ` · registered ${registered}`}
          </div>
        </div>
        <span className={`pill pill--${STATUS_PILL[s.status] ?? 'unmarked'}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
      </div>

      {(s.adminName || s.adminEmail || s.adminPhone) && (
        <div className="school-card__admin">
          <span className="school-card__label">School admin</span>
          <span>{s.adminName || '-'}</span>
          {s.adminEmail && <a href={`mailto:${s.adminEmail}`}><MailIcon size={14} /> {s.adminEmail}</a>}
          {s.adminPhone && <a href={`tel:${s.adminPhone}`}><PhoneIcon size={14} /> {s.adminPhone}</a>}
        </div>
      )}

      {(s.status === 'active' || s.status === 'inactive') && (
        <div className="school-card__meta">
          {s.classCount} class{s.classCount === 1 ? '' : 'es'} · {s.studentCount} student{s.studentCount === 1 ? '' : 's'}
        </div>
      )}

      {s.reviewNote && (
        <p className="school-card__note">
          <b>{s.status === 'rejected' ? 'Reason: ' : 'Note: '}</b>{s.reviewNote}
        </p>
      )}
      {reviewed && s.status !== 'pending' && (
        <div className="school-card__meta">
          {STATUS_LABEL[s.status]} {reviewed}{s.reviewedBy ? ` by ${s.reviewedBy}` : ''}
        </div>
      )}

      {ACTIONS_FOR[s.status]?.length > 0 && (
        <div className="school-card__actions">
          {ACTIONS_FOR[s.status].map((action) => (
            <button
              key={action}
              type="button"
              className={`${action === 'reject' || action === 'disable' ? 'btn btn--sm btn--outline' : 'btn btn--sm'}`}
              onClick={() => onAction(action)}
            >
              {ACTIONS[action].label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

/** "Are you sure?" sheet for one status change, with a reason box where one is wanted. */
function ConfirmSchoolAction({ school, action, onUnauthorized, onClose, onDone }) {
  const spec = ACTIONS[action];
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const needsNote = spec.note === 'required' && !note.trim();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function confirm(e) {
    e.preventDefault();
    if (needsNote) return;
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
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose} role="presentation">
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-school-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={confirm}
      >
        <div className="sheet__grip" />
        <div className="sheet__name" id="confirm-school-title">{spec.title(school)}</div>
        <p className="sheet__sub">{spec.body}</p>

        {error && <div className="notice notice--err" role="alert">{error}</div>}

        {spec.note && (
          <div className="field">
            <label className="field__label" htmlFor="school-note">{spec.noteLabel}</label>
            <textarea
              id="school-note"
              className="field__input field__input--area"
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

        <div className="sheet__actions">
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`${spec.tone} btn--sm`} disabled={busy || needsNote}>
            {busy ? 'Saving…' : spec.label}
          </button>
        </div>
      </form>
    </div>
  );
}
