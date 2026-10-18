import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getClassRegister, saveClassRegister, getTeachers, updateClass } from '../../services/adminService';
import { todayISO } from '../../db/database';
import { showToast } from '../../lib/toast';
import ConfirmDialog from '../ConfirmDialog';
import Avatar from '../Avatar';
import { SearchIcon, UserIcon, RosterIcon, CheckCircleIcon } from '../icons';
import { readAdminDate, writeAdminDate } from './adminDate';

const STATUSES = [
  { id: 'present', label: 'Present', short: 'P' },
  { id: 'late', label: 'Late', short: 'L' },
  { id: 'absent', label: 'Absent', short: 'A' },
];
const ABSENCE_REASONS = { fee: 'School fees', health: 'Sick', other: 'Other', unknown: 'Unknown' };

const OVERRIDE_REASONS = {
  teacher_absent: 'The class teacher is away',
  wrong_mark: 'A mark was wrong',
  late_arrival: 'A student arrived late',
  gate_error: 'The gate scanner got it wrong',
  other: 'Something else (explain below)',
};

const SOURCE = { rfid: 'Gate', fingerprint: 'Gate', manual: 'Teacher' };
const classLabel = (c) => (c ? [c.grade, c.stream].filter(Boolean).join(' ') || 'Class' : 'Class');
const shortTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '');

/** Where a mark came from, for the small label under it. */
function markSource(student, adminEmail) {
  const { mark, override } = student;
  if (!mark) return null;
  if (override) return { tone: 'admin', text: `Changed by ${override.actor === adminEmail ? 'you' : override.actor}` };
  return { tone: mark.captureMethod === 'manual' ? 'teacher' : 'gate', text: `${SOURCE[mark.captureMethod] ?? 'Recorded'} ${shortTime(mark.createdAt)}` };
}

/**
 * One class for the school admin: its teacher, and its register for any day,
 * which the admin can take (teacher away) or correct. Every change asks for a
 * reason and is logged against the admin.
 */
export default function AdminClassPage({ classGroupId, onTitle }) {
  const { user } = useAuth();
  const schoolId = user?.schoolId;
  const [date, setDate] = useState(readAdminDate);
  const [data, setData] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({}); // studentId -> { status, absenceReason }
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const [register, tch] = await Promise.all([
        getClassRegister(classGroupId, date),
        schoolId ? getTeachers(schoolId) : [],
      ]);
      setData(register);
      setTeachers(tch.filter((t) => t.status !== 'disabled'));
      setDrafts({});
      setError(null);
      onTitle?.(classGroupId, classLabel(register.class));
    } catch (err) {
      setError(err.message ?? 'Could not load this class');
    }
  }, [classGroupId, date, schoolId, onTitle]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { writeAdminDate(date); }, [date]);

  // A draft only counts while it differs from what the server has.
  const effective = (st) => drafts[st.studentId] ?? (st.mark ? { status: st.mark.status, absenceReason: st.mark.absenceReason ?? null } : null);
  const changes = useMemo(() => (data?.students ?? []).filter((st) => {
    const d = drafts[st.studentId];
    if (!d) return false;
    return !st.mark || d.status !== st.mark.status || (d.status === 'absent' && (d.absenceReason ?? null) !== (st.mark.absenceReason ?? null));
  }), [data, drafts]);

  const setMark = (st, status) => setDrafts((all) => ({
    ...all,
    [st.studentId]: { status, absenceReason: status === 'absent' ? (all[st.studentId]?.absenceReason ?? st.mark?.absenceReason ?? null) : null },
  }));
  const setReason = (st, absenceReason) => setDrafts((all) => ({
    ...all, [st.studentId]: { status: 'absent', absenceReason: absenceReason || null },
  }));

  const unmarked = (data?.students ?? []).filter((st) => !effective(st));
  const markRestPresent = () => setDrafts((all) => ({
    ...all,
    ...Object.fromEntries(unmarked.map((st) => [st.studentId, { status: 'present', absenceReason: null }])),
  }));

  async function changeTeacher(teacherUserId) {
    try {
      const updated = await updateClass(classGroupId, { teacherUserId: teacherUserId || null });
      showToast(updated.teacherName ? `${updated.teacherName} now teaches ${classLabel(updated)}` : 'Teacher removed from this class');
      await load();
    } catch (err) {
      showToast(err.message ?? 'Could not change the teacher', { tone: 'error' });
    }
  }

  if (error) return <div className="notice notice--err" role="alert">{error}</div>;
  if (!data) return <p className="empty">Loading class…</p>;

  const q = query.trim().toLowerCase();
  const students = data.students.filter((st) => !q || st.fullName.toLowerCase().includes(q) || (st.admissionNo ?? '').toLowerCase().includes(q));
  const isToday = date === todayISO();
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, data.students.filter((st) => effective(st)?.status === s.id).length]));

  return (
    <div className="ad-page register">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">{classLabel(data.class)}</h2>
          <p className="page-head__sub">
            {data.students.length} student{data.students.length === 1 ? '' : 's'} ·{' '}
            {isToday ? "today's register" : new Date(`${date}T00:00`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="page-head__actions">
          <label className="ad-teacher-pick">
            <UserIcon size={15} />
            <select value={data.class.teacherUserId ?? ''} onChange={(e) => changeTeacher(e.target.value)} aria-label="Class teacher">
              <option value="">{data.class.teacherName && !data.class.teacherUserId ? `${data.class.teacherName} (no account)` : 'No teacher'}</option>
              {teachers.map((t) => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}
            </select>
          </label>
          <label className="date-input">
            <span className="sr-only">Register date</span>
            <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} disabled={changes.length > 0} />
          </label>
        </div>
      </div>

      <div className="ad-register-summary">
        <span className="ad-chip ad-chip--present">{counts.present} present</span>
        <span className="ad-chip ad-chip--late">{counts.late} late</span>
        <span className="ad-chip ad-chip--absent">{counts.absent} absent</span>
        <span className="ad-chip ad-chip--unmarked">{unmarked.length} not marked</span>
        {unmarked.length > 0 && (
          <button type="button" className="btn btn--outline btn--sm" onClick={markRestPresent}>
            <CheckCircleIcon size={15} /> Mark the rest present
          </button>
        )}
      </div>

      {data.students.length === 0 ? (
        <div className="ad-empty">
          <span className="ad-empty__icon"><RosterIcon size={24} /></span>
          <p className="ad-empty__title">No students in this class yet</p>
          <p className="ad-empty__text">The class teacher adds students from their phone.</p>
        </div>
      ) : (
        <div className="panel">
          <div className="panel__toolbar">
            <div className="search">
              <SearchIcon size={16} />
              <input type="search" placeholder="Search by name or admission no." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search students" />
            </div>
          </div>
          <ul className="ad-register" aria-label="Register">
            {students.map((st) => {
              const current = effective(st);
              const edited = changes.includes(st);
              const source = markSource(st, user?.username);
              return (
                <li key={st.studentId} className={`ad-mark${edited ? ' ad-mark--edited' : ''}${current ? ` ad-mark--${current.status}` : ' ad-mark--none'}`}>
                  <span className="student-cell">
                    <Avatar name={st.fullName} size="sm" />
                    <span className="student-cell__text">
                      <span className="student-cell__name">{st.fullName}</span>
                      <span className="student-cell__sub">
                        {st.admissionNo || '-'}
                        {edited ? <span className="ad-src ad-src--edited">changed, not saved</span>
                          : source ? <span className={`ad-src ad-src--${source.tone}`}>{source.text}</span>
                            : <span className="ad-src ad-src--none">not marked</span>}
                      </span>
                    </span>
                  </span>
                  <span className="ad-mark__controls">
                    <span className="ad-seg" role="group" aria-label={`Mark ${st.fullName}`}>
                      {STATUSES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`ad-seg__btn ad-seg__btn--${s.id}`}
                          aria-pressed={current?.status === s.id}
                          aria-label={`${s.label}: ${st.fullName}`}
                          onClick={() => setMark(st, s.id)}
                        >
                          <span className="ad-seg__long">{s.label}</span><span className="ad-seg__short">{s.short}</span>
                        </button>
                      ))}
                    </span>
                    {current?.status === 'absent' && (
                      <select
                        className="reason-select"
                        value={current.absenceReason ?? ''}
                        onChange={(e) => setReason(st, e.target.value)}
                        aria-label={`Why ${st.fullName} is absent`}
                      >
                        <option value="">Reason…</option>
                        {Object.entries(ABSENCE_REASONS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {changes.length > 0 && (
        <div className="savebar">
          <div className="savebar__meta">
            <b>{changes.length} change{changes.length === 1 ? '' : 's'}</b> to {classLabel(data.class)}&apos;s register. You&apos;ll be asked why.
          </div>
          <div className="savebar__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setDrafts({})}>Discard</button>
            <button type="button" className="btn btn--sm" onClick={() => setConfirming(true)}>Save changes</button>
          </div>
        </div>
      )}

      {confirming && (
        <SaveRegisterDialog
          classGroupId={classGroupId}
          className={classLabel(data.class)}
          teacherName={data.class.teacherName}
          date={date}
          marks={changes.map((st) => {
            const d = drafts[st.studentId];
            return { studentId: st.studentId, status: d.status, ...(d.status === 'absent' && d.absenceReason ? { absenceReason: d.absenceReason } : {}) };
          })}
          onClose={() => setConfirming(false)}
          onSaved={async (result) => {
            setConfirming(false);
            showToast(`${result.changed.length} mark${result.changed.length === 1 ? '' : 's'} saved for ${classLabel(data.class)}`);
            await load();
          }}
        />
      )}
    </div>
  );
}

/** "Why are you changing this register?" before saving. */
function SaveRegisterDialog({ classGroupId, className, teacherName, date, marks, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const needsNote = reason === 'other' && note.trim().length < 3;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveClassRegister(classGroupId, { date, reason, ...(note.trim() ? { note: note.trim() } : {}), marks }));
    } catch (err) {
      setError(err.message ?? 'Could not save the register');
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      tone="primary"
      Icon={RosterIcon}
      title={`Save ${marks.length} change${marks.length === 1 ? '' : 's'} to ${className}?`}
      body={`Saved under your name${teacherName ? ` on behalf of ${teacherName}` : ''}, with the reason below. ${teacherName ?? 'The teacher'} sees the change on their phone.`}
      confirmLabel="Save changes"
      busy={busy}
      error={error}
      confirmDisabled={!reason || needsNote}
      onCancel={onClose}
      onConfirm={save}
    >
      <fieldset className="ad-reasons">
        <legend className="sa-field__label">Why are you changing this register?</legend>
        {Object.entries(OVERRIDE_REASONS).map(([value, label]) => (
          <label key={value} className={`ad-reason${reason === value ? ' ad-reason--on' : ''}`}>
            <input type="radio" name="override-reason" value={value} checked={reason === value} onChange={() => setReason(value)} disabled={busy} />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="sa-field">
        <label className="sa-field__label" htmlFor="override-note">Note {reason === 'other' ? '' : <span className="field__opt">(optional)</span>}</label>
        <textarea id="override-note" className="sa-field__input" rows={2} maxLength={500} value={note}
          placeholder="e.g. Ms. Otieno is at a workshop" onChange={(e) => setNote(e.target.value)} disabled={busy} />
      </div>
    </ConfirmDialog>
  );
}
