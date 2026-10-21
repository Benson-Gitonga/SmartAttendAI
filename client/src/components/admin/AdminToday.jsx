import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getRegisterBoard, getTeachers } from '../../services/adminService';
import { todayISO } from '../../db/database';
import { readAdminDate, writeAdminDate } from './adminDate';
import { SyncIcon } from '../icons';

const STATUS = {
  done: { label: 'Taken', tone: 'active' },
  partial: { label: 'Part taken', tone: 'pending' },
  gate_only: { label: 'Gate scans only', tone: 'pending' },
  not_taken: { label: 'Not taken', tone: 'rejected' },
  empty: { label: 'No students', tone: 'inactive' },
};

const FILTERS = [
  { id: 'waiting', label: 'Not taken yet', test: (c) => ['not_taken', 'gate_only', 'partial'].includes(c.status) },
  { id: 'done', label: 'Taken', test: (c) => c.status === 'done' },
  { id: 'all', label: 'All classes', test: () => true },
];

const className = (c) => [c.grade, c.stream].filter(Boolean).join(' ') || 'Class';
const percent = (rate) => (rate == null ? '-' : `${Math.round(rate * 100)}%`);
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : null);

/**
 * The school admin's home: a summary of the day, which classes have not taken
 * the register, and (until the school is set up) the steps to get there.
 */
export default function AdminToday({ onOpenClass, onGo }) {
  const { user } = useAuth();
  const schoolId = user?.schoolId;
  const [date, setDate] = useState(readAdminDate);
  useEffect(() => { writeAdminDate(date); }, [date]);
  const [board, setBoard] = useState(null);
  const [teacherCount, setTeacherCount] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('waiting');

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [b, teachers] = await Promise.all([getRegisterBoard(schoolId, date), getTeachers(schoolId)]);
      setBoard(b);
      setTeacherCount(teachers.filter((t) => t.status !== 'disabled').length);
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
  // Open on the classes that still need the register; once all are done, show them all.
  const activeFilter = filter === 'waiting' && board && counts.waiting === 0 ? 'all' : filter;
  const visible = (board?.classes ?? []).filter(FILTERS.find((f) => f.id === activeFilter).test);
  const isToday = date === todayISO();
  const t = board?.totals;

  const setup = board && teacherCount != null ? [
    { id: 'classes', done: board.classes.length > 0, label: 'Create your classes', go: 'classes' },
    { id: 'students', done: t.students > 0, label: 'Add students (one by one or from a CSV file)', go: 'students' },
    { id: 'teachers', done: teacherCount > 0, label: 'Invite your teachers', go: 'teachers' },
    { id: 'assign', done: board.classes.length > 0 && board.classes.every((c) => c.teacherUserId), label: 'Give every class a teacher', go: 'classes' },
  ] : null;
  const setupLeft = setup?.filter((s) => !s.done).length ?? 0;

  return (
    <div className="ad-page ad-console">
      <div className="sys-pagehead">
        <div>
          <h1 className="sys-pagehead__title">{isToday ? 'Today' : new Date(`${date}T00:00`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
          <p className="sys-pagehead__sub">{user?.schoolName ?? 'Your school'} · attendance across every class</p>
        </div>
        <div className="sys-pagehead__actions">
          <input className="sys-input sys-input--date" type="date" value={date} max={todayISO()} aria-label="Day" onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button type="button" className="sys-btn sys-btn--secondary" onClick={load} disabled={loading}>
            <SyncIcon size={14} className={loading ? 'sa-spin' : undefined} /> Refresh
          </button>
          <button type="button" className="sys-btn sys-btn--secondary ad-scan-link" onClick={() => onGo?.('scan')}>Scan station</button>
        </div>
      </div>

      {error && <div className="sys-banner sys-banner--error" role="alert">Could not load the registers ({error}).</div>}
      {!error && !board && <p className="sys-muted" role="status">Loading…</p>}

      {setup && setupLeft > 0 && (
        <section className="sys-panel ad-setup">
          <div className="sys-toolbar">
            <span className="sys-toolbar__title">Set up your school</span>
            <span className="sys-toolbar__count">{setup.length - setupLeft} of {setup.length} done</span>
          </div>
          <ol className="ad-setup__list">
            {setup.map((step) => (
              <li key={step.id} className={step.done ? 'is-done' : undefined}>
                <span className="ad-setup__mark" aria-hidden="true">{step.done ? '✓' : ''}</span>
                <span className="ad-setup__label">{step.label}</span>
                {!step.done && <button type="button" className="sys-btn sys-btn--secondary sys-btn--sm" onClick={() => onGo?.(step.go)}>Open</button>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {t && board.classes.length > 0 && (
        <dl className="ad-stats">
          <div><dt>Registers taken</dt><dd>{t.done} <span>of {t.classes}</span></dd></div>
          <div><dt>Attendance</dt><dd>{percent(t.attendanceRate)}</dd></div>
          <div><dt>Present</dt><dd>{t.present + t.late}</dd></div>
          <div><dt>Absent</dt><dd>{t.absent}</dd></div>
          <div><dt>Not marked yet</dt><dd>{t.unmarked}</dd></div>
        </dl>
      )}

      {board && board.classes.length > 0 && (
        <>
          <nav className="sys-tabs" role="tablist" aria-label="Filter classes">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" className="sys-tab" aria-selected={activeFilter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}<span className="sys-tab__count">{counts[f.id]}</span>
              </button>
            ))}
          </nav>

          <section className="sys-panel">
            <table className="sys-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Teacher</th>
                  <th>Register</th>
                  <th className="sys-num">Marked</th>
                  <th className="sys-num">Present</th>
                  <th className="sys-num">Absent</th>
                  <th className="sys-table__actions"><span className="sa-visually-hidden">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={7} className="sys-table__empty">Every class has taken its register.</td></tr>
                )}
                {visible.map((c) => {
                  const s = STATUS[c.status] ?? STATUS.not_taken;
                  const marked = c.studentCount - c.unmarked;
                  return (
                    <tr key={c.classGroupId} onClick={() => onOpenClass(c.classGroupId)}>
                      <td data-label="Class">
                        <button type="button" className="sys-table__name" onClick={(e) => { e.stopPropagation(); onOpenClass(c.classGroupId); }}>{className(c)}</button>
                      </td>
                      <td data-label="Teacher">{c.teacherName || <span className="sys-muted">No teacher</span>}</td>
                      <td data-label="Register">
                        <span className={`sys-status sys-status--${s.tone}`}>{s.label}</span>
                        {c.lastMarkAt && <div className="sys-table__sub">last mark {time(c.lastMarkAt)}</div>}
                      </td>
                      <td data-label="Marked" className="sys-num">{marked}/{c.studentCount}</td>
                      <td data-label="Present" className="sys-num">{c.present + c.late}</td>
                      <td data-label="Absent" className="sys-num">{c.absent}</td>
                      <td className="sys-table__actions">
                        <button type="button" className="sys-btn sys-btn--secondary sys-btn--sm" onClick={(e) => { e.stopPropagation(); onOpenClass(c.classGroupId); }}>
                          {c.status === 'done' ? 'View' : 'Take register'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
