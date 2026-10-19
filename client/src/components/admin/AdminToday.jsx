import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getRegisterBoard } from '../../services/adminService';
import { todayISO } from '../../db/database';
import { readAdminDate, writeAdminDate } from './adminDate';
import { ArrowRightIcon, CheckCircleIcon, ClockIcon, AlertTriangleIcon, SyncIcon, UsersIcon } from '../icons';

const STATUS = {
  done: { label: 'Done', tone: 'done', Icon: CheckCircleIcon },
  partial: { label: 'Part done', tone: 'partial', Icon: ClockIcon },
  gate_only: { label: 'Gate only', tone: 'partial', Icon: ClockIcon },
  not_taken: { label: 'Not taken', tone: 'missing', Icon: AlertTriangleIcon },
  empty: { label: 'No students', tone: 'empty', Icon: UsersIcon },
};

const FILTERS = [
  { id: 'waiting', label: 'Needs attention', test: (c) => ['not_taken', 'gate_only', 'partial'].includes(c.status) },
  { id: 'done', label: 'Done', test: (c) => c.status === 'done' },
  { id: 'all', label: 'All classes', test: () => true },
];

const className = (c) => [c.grade, c.stream].filter(Boolean).join(' ') || 'Class';
const percent = (rate) => (rate == null ? '-' : `${Math.round(rate * 100)}%`);
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : null);

/**
 * The school admin's home: every class's register for one day, so classes
 * that have not taken it stand out and can be opened and taken or corrected.
 */
export default function AdminToday({ onOpenClass }) {
  const { user } = useAuth();
  const schoolId = user?.schoolId;
  const [date, setDate] = useState(readAdminDate);
  useEffect(() => { writeAdminDate(date); }, [date]);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('waiting');

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      setBoard(await getRegisterBoard(schoolId, date));
      setError(null);
    } catch (err) {
      setError(err.message ?? 'Could not load the registers');
    } finally {
      setLoading(false);
    }
  }, [schoolId, date]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, (board?.classes ?? []).filter(f.test).length])),
    [board]
  );
  // Open on the classes that need something; once all are done, show them all.
  const activeFilter = filter === 'waiting' && board && counts.waiting === 0 ? 'all' : filter;
  const visible = (board?.classes ?? []).filter(FILTERS.find((f) => f.id === activeFilter).test);
  const isToday = date === todayISO();
  const t = board?.totals;

  return (
    <div className="ad-page">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">{isToday ? "Today's registers" : 'Registers'}</h2>
          <p className="page-head__sub">
            {isToday
              ? 'Every class in the school. Open one to take the register for an absent teacher or correct a mark.'
              : `Every class's register on ${new Date(`${date}T00:00`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}.`}
          </p>
        </div>
        <div className="page-head__actions">
          <label className="date-input">
            <span className="sr-only">Day</span>
            <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <button type="button" className="btn btn--outline btn--sm" onClick={load} disabled={loading}>
            <SyncIcon size={15} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="notice notice--err" role="alert">Could not load the registers ({error}).</div>}
      {!error && !board && <p className="empty">Loading registers…</p>}

      {t && (
        <div className="ad-totals">
          <div className="ad-total ad-total--hero">
            <span className="ad-total__value">{t.done}<small>/{t.classes}</small></span>
            <span className="ad-total__label">classes done</span>
            <span className="ad-meter" aria-hidden="true">
              <span style={{ width: `${t.classes ? (t.done / t.classes) * 100 : 0}%` }} />
            </span>
          </div>
          <div className="ad-total"><span className="ad-total__value">{percent(t.attendanceRate)}</span><span className="ad-total__label">attendance</span></div>
          <div className="ad-total ad-total--ok"><span className="ad-total__value">{t.present + t.late}</span><span className="ad-total__label">in school</span></div>
          <div className="ad-total ad-total--bad"><span className="ad-total__value">{t.absent}</span><span className="ad-total__label">absent</span></div>
          <div className="ad-total ad-total--warn"><span className="ad-total__value">{t.unmarked}</span><span className="ad-total__label">not marked yet</span></div>
        </div>
      )}

      {board && (
        <>
          <div className="chips ad-filters" role="tablist" aria-label="Filter classes">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                className="chip"
                aria-selected={activeFilter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="chip__count">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          {board.classes.length === 0 && (
            <div className="ad-empty">
              <p className="ad-empty__title">No classes yet</p>
              <p className="ad-empty__text">Create your school&apos;s classes under <b>Classes</b> and assign each one a teacher.</p>
            </div>
          )}

          <div className="ad-board">
            {visible.map((c) => {
              const s = STATUS[c.status] ?? STATUS.not_taken;
              const marked = c.studentCount - c.unmarked;
              return (
                <button key={c.classGroupId} type="button" className={`ad-tile ad-tile--${s.tone}`} onClick={() => onOpenClass(c.classGroupId)}>
                  <span className="ad-tile__head">
                    <span className="ad-tile__name">{className(c)}</span>
                    <span className={`ad-status ad-status--${s.tone}`}><s.Icon size={13} /> {s.label}</span>
                  </span>
                  <span className="ad-tile__teacher">{c.teacherName || 'No teacher assigned'}</span>
                  {c.studentCount > 0 && (
                    <>
                      <span className="ad-meter" aria-hidden="true">
                        <span style={{ width: `${(marked / c.studentCount) * 100}%` }} />
                      </span>
                      <span className="ad-tile__counts">
                        <span>{marked}/{c.studentCount} marked</span>
                        {c.absent > 0 && <span className="ad-tile__absent">{c.absent} absent</span>}
                        {c.lastMarkAt && <span>last {time(c.lastMarkAt)}</span>}
                      </span>
                    </>
                  )}
                  <span className="ad-tile__go">
                    {c.status === 'done' ? 'View or correct' : 'Take register'} <ArrowRightIcon size={14} />
                  </span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 && board.classes.length > 0 && (
            <p className="empty">Nothing here: every class has taken its register.</p>
          )}
        </>
      )}
    </div>
  );
}
