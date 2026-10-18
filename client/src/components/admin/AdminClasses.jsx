import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getSchoolClasses, getTeachers, createClass, updateClass } from '../../services/adminService';
import { showToast } from '../../lib/toast';
import ConfirmDialog from '../ConfirmDialog';
import { ArrowRightIcon, BuildingIcon, UserIcon } from '../icons';

const GRADES = ['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
const classLabel = (c) => [c.grade, c.stream].filter(Boolean).join(' ') || 'Class';

/** Every class in the school: create classes and choose who teaches each one. */
export default function AdminClasses({ onOpenClass }) {
  const { user } = useAuth();
  const schoolId = user?.schoolId;
  const [classes, setClasses] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      const [cls, tch] = await Promise.all([getSchoolClasses(schoolId), getTeachers(schoolId)]);
      setClasses(cls);
      setTeachers(tch.filter((t) => t.status !== 'disabled'));
      setError(null);
    } catch (err) {
      setError(err.message ?? 'Could not load the classes');
    }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  async function assign(cls, teacherUserId) {
    setSavingId(cls.classGroupId);
    try {
      const updated = await updateClass(cls.classGroupId, { teacherUserId: teacherUserId || null });
      showToast(updated.teacherName ? `${classLabel(cls)} is now taught by ${updated.teacherName}` : `${classLabel(cls)} has no teacher now`);
      await load();
    } catch (err) {
      showToast(err.message ?? 'Could not change the teacher', { tone: 'error' });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="ad-page">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">Classes</h2>
          <p className="page-head__sub">
            You set up the school&apos;s classes. Each teacher sees only the classes you give them.
          </p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn btn--sm" onClick={() => setCreating(true)}>+ New class</button>
        </div>
      </div>

      {error && <div className="notice notice--err" role="alert">{error}</div>}
      {!error && classes === null && <p className="empty">Loading classes…</p>}

      {classes && classes.length === 0 && (
        <div className="ad-empty">
          <span className="ad-empty__icon"><BuildingIcon size={24} /></span>
          <p className="ad-empty__title">No classes yet</p>
          <p className="ad-empty__text">Create your first class, then choose its teacher.</p>
          <button type="button" className="btn btn--sm" onClick={() => setCreating(true)}>+ New class</button>
        </div>
      )}

      {classes && classes.length > 0 && (
        <div className="ad-list" role="list">
          {classes.map((c) => (
            <div key={c.classGroupId} className="ad-row" role="listitem">
              <button type="button" className="ad-row__main" onClick={() => onOpenClass(c.classGroupId)}>
                <span className="ad-row__name">{classLabel(c)}</span>
                <span className="ad-row__meta">{c.studentCount} student{c.studentCount === 1 ? '' : 's'} · {c.academicYear}</span>
              </button>
              <label className="ad-row__teacher">
                <span className="sr-only">Teacher for {classLabel(c)}</span>
                <UserIcon size={15} />
                <select
                  value={c.teacherUserId ?? ''}
                  onChange={(e) => assign(c, e.target.value)}
                  disabled={savingId === c.classGroupId}
                  aria-label={`Teacher for ${classLabel(c)}`}
                >
                  <option value="">{c.teacherName && !c.teacherUserId ? `${c.teacherName} (no account)` : 'No teacher'}</option>
                  {teachers.map((t) => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}
                </select>
              </label>
              <button type="button" className="ad-row__go" onClick={() => onOpenClass(c.classGroupId)} aria-label={`Open ${classLabel(c)}`}>
                <ArrowRightIcon size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {classes && teachers.length === 0 && classes.length > 0 && (
        <p className="ad-hint">There are no teacher accounts yet, so classes cannot be assigned. Teacher invites are coming next.</p>
      )}

      {creating && (
        <CreateClassDialog
          schoolId={schoolId}
          teachers={teachers}
          onClose={() => setCreating(false)}
          onCreated={async (cls) => {
            setCreating(false);
            showToast(`${classLabel(cls)} created`);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CreateClassDialog({ schoolId, teachers, onClose, onCreated }) {
  const [grade, setGrade] = useState('Form 1');
  const [stream, setStream] = useState('');
  const [teacherUserId, setTeacherUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onCreated(await createClass(schoolId, { grade, stream: stream.trim(), teacherUserId }));
    } catch (err) {
      setError(err.message ?? 'Could not create the class');
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      tone="primary"
      Icon={BuildingIcon}
      title="New class"
      body="The teacher you choose will see this class on their phone the next time they open SmartAttend."
      confirmLabel="Create class"
      busy={busy}
      error={error}
      confirmDisabled={!grade.trim()}
      onCancel={onClose}
      onConfirm={save}
    >
      <div className="sa-field ad-dialog-row">
        <label className="sa-field__label" htmlFor="nc-grade">Grade</label>
        <input id="nc-grade" className="sa-field__input sa-field__input--line" list="nc-grades" value={grade}
          onChange={(e) => setGrade(e.target.value)} disabled={busy} autoFocus />
        <datalist id="nc-grades">{GRADES.map((g) => <option key={g} value={g} />)}</datalist>
      </div>
      <div className="sa-field ad-dialog-row">
        <label className="sa-field__label" htmlFor="nc-stream">Stream <span className="field__opt">(optional)</span></label>
        <input id="nc-stream" className="sa-field__input sa-field__input--line" placeholder="e.g. North, A, Blue" value={stream}
          onChange={(e) => setStream(e.target.value)} disabled={busy} />
      </div>
      <div className="sa-field ad-dialog-row">
        <label className="sa-field__label" htmlFor="nc-teacher">Class teacher</label>
        <select id="nc-teacher" className="sa-field__input sa-field__input--line" value={teacherUserId}
          onChange={(e) => setTeacherUserId(e.target.value)} disabled={busy}>
          <option value="">Choose later</option>
          {teachers.map((t) => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}
        </select>
      </div>
    </ConfirmDialog>
  );
}
