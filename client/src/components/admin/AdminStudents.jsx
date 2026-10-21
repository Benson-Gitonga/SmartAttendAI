import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  getStudents, getSchoolClasses, enrolStudent, importStudents, updateStudent, reissueCard,
} from '../../services/adminService';
import { studentsFromCsv, STUDENT_CSV_TEMPLATE } from '../../lib/csv';
import { showToast } from '../../lib/toast';
import ConfirmDialog from '../ConfirmDialog';
import Drawer from './Drawer';
import { SearchIcon } from '../icons';

const classLabel = (c) => [c.grade, c.stream].filter(Boolean).join(' ') || 'Class';
const KENYAN_PHONE = /^(\+254|0)[17]\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A file's text. FileReader as well, for older phone browsers without Blob.text(). */
const readText = (file) => (typeof file.text === 'function' ? file.text() : new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
}));

/**
 * The school's students. Only the school admin adds, edits, moves and removes
 * them; each class's teacher gets the list on their phone. Every new student
 * gets a card number, printed on their ID card as a barcode and QR code.
 */
export default function AdminStudents({ onPrintCards }) {
  const { user } = useAuth();
  const schoolId = user?.schoolId;
  const [classes, setClasses] = useState(null);
  const [students, setStudents] = useState(null);
  const [classId, setClassId] = useState('');
  const [query, setQuery] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // a student, or {} for a new one
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      const [cls, list] = await Promise.all([
        getSchoolClasses(schoolId),
        getStudents(schoolId, { includeInactive: true }),
      ]);
      setClasses(cls);
      setStudents(list);
      setError(null);
    } catch (err) {
      setError(err.message ?? 'Could not load the students');
    }
  }, [schoolId]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (students ?? []).filter((s) => (showRemoved ? !s.active : s.active)
      && (!classId || s.classGroupId === classId)
      && (!q || s.fullName.toLowerCase().includes(q) || (s.admissionNo ?? '').toLowerCase().includes(q) || (s.cardUid ?? '').toLowerCase().includes(q)));
  }, [students, classId, query, showRemoved]);

  const activeCount = (students ?? []).filter((s) => s.active).length;
  const removedCount = (students ?? []).length - activeCount;
  const currentClass = classes?.find((c) => c.classGroupId === classId);
  const noClasses = classes && classes.length === 0;

  function printCards() {
    const list = visible.filter((s) => s.active);
    onPrintCards(list, currentClass ? `ID cards: ${classLabel(currentClass)}` : 'ID cards: all students');
  }

  return (
    <div className="ad-page ad-console">
      <div className="sys-pagehead">
        <div>
          <h1 className="sys-pagehead__title">Students</h1>
          {students && (
            <p className="sys-pagehead__sub">
              {activeCount} enrolled{removedCount > 0 ? ` · ${removedCount} removed` : ''}. Teachers see their class lists on their phones.
            </p>
          )}
        </div>
        <div className="sys-pagehead__actions">
          <button type="button" className="sys-btn sys-btn--secondary" onClick={() => setImporting(true)} disabled={!classes || noClasses}>Import from CSV</button>
          <button type="button" className="sys-btn sys-btn--primary" onClick={() => setEditing({})} disabled={!classes || noClasses}>Add student</button>
        </div>
      </div>

      {error && <div className="sys-banner sys-banner--error" role="alert">{error} <button type="button" className="sys-linkbtn" onClick={load}>Try again</button></div>}
      {noClasses && <div className="sys-banner sys-banner--info">Create a class first (Classes page). Students are enrolled into a class.</div>}

      <section className="sys-panel">
        <div className="sys-toolbar">
          <div className="sys-toolbar__left">
            <select className="sys-select" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
              <option value="">All classes</option>
              {(classes ?? []).map((c) => <option key={c.classGroupId} value={c.classGroupId}>{classLabel(c)}</option>)}
            </select>
            <label className="sys-search">
              <SearchIcon size={14} />
              <input type="search" placeholder="Search name, admission or card no." aria-label="Search students" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          <div className="sys-toolbar__right">
            {removedCount > 0 && (
              <label className="sys-check">
                <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed
              </label>
            )}
            <button type="button" className="sys-btn sys-btn--secondary sys-btn--sm" onClick={printCards} disabled={showRemoved || visible.length === 0}>
              Print ID cards{visible.length > 0 && !showRemoved ? ` (${visible.length})` : ''}
            </button>
          </div>
        </div>

        <table className="sys-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Adm. no.</th>
              <th>Class</th>
              <th>Guardian</th>
              <th>Card no.</th>
              <th className="sys-table__actions"><span className="sa-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {!students && !error && <tr><td colSpan={6} className="sys-table__empty" role="status">Loading students…</td></tr>}
            {students && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="sys-table__empty">
                  {query.trim() ? `No students match “${query.trim()}”.`
                    : showRemoved ? 'No removed students here.'
                      : currentClass ? `No students in ${classLabel(currentClass)} yet. Add them one by one or import a CSV.`
                        : 'No students yet. Add them one by one or import a class list from a CSV file.'}
                </td>
              </tr>
            )}
            {visible.map((s) => (
              <tr key={s.studentId} onClick={() => setEditing(s)}>
                <td data-label="Name">
                  <button type="button" className="sys-table__name" onClick={(e) => { e.stopPropagation(); setEditing(s); }}>{s.fullName}</button>
                </td>
                <td data-label="Adm. no.">{s.admissionNo || <span className="sys-muted">-</span>}</td>
                <td data-label="Class">{s.className}</td>
                <td data-label="Guardian">
                  {s.guardianPhone || <span className="sys-muted">-</span>}
                  {s.guardianEmail && <div className="sys-table__sub">{s.guardianEmail}</div>}
                </td>
                <td data-label="Card no." className="sys-mono">{s.cardUid ?? <span className="sys-muted">none</span>}</td>
                <td className="sys-table__actions">
                  <button type="button" className="sys-btn sys-btn--secondary sys-btn--sm" onClick={(e) => { e.stopPropagation(); setEditing(s); }}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editing && (
        <StudentDrawer
          key={`${editing.studentId ?? 'new'}-${editing.cardUid ?? ''}`}
          student={editing.studentId ? editing : null}
          classes={classes ?? []}
          defaultClassId={classId || classes?.[0]?.classGroupId}
          onClose={() => setEditing(null)}
          onPrintCard={(s) => onPrintCards([s], `ID card: ${s.fullName}`)}
          onSaved={async (saved, message) => {
            showToast(message);
            await load();
            // Stays open only after a new card, to show the new number.
            setEditing(saved ?? null);
          }}
        />
      )}

      {importing && (
        <ImportDialog
          classes={classes ?? []}
          defaultClassId={classId || classes?.[0]?.classGroupId}
          onClose={() => setImporting(false)}
          onImported={async (created, cls) => {
            setImporting(false);
            showToast(`${created.length} student${created.length === 1 ? '' : 's'} added to ${classLabel(cls)}`);
            setClassId(cls.classGroupId);
            await load();
          }}
        />
      )}
    </div>
  );
}

/** Add a student, or edit one: details, class (moving), a new card, removing. */
function StudentDrawer({ student, classes, defaultClassId, onClose, onSaved, onPrintCard }) {
  const isNew = !student;
  const [form, setForm] = useState(() => ({
    fullName: student?.fullName ?? '',
    admissionNo: student?.admissionNo ?? '',
    classGroupId: student?.classGroupId ?? defaultClassId ?? '',
    guardianPhone: student?.guardianPhone ?? '',
    guardianEmail: student?.guardianEmail ?? '',
  }));
  const [problems, setProblems] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'remove' | 'card'

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  function check() {
    const p = {};
    if (form.fullName.trim().length < 2) p.fullName = 'Enter the student’s full name.';
    if (!form.classGroupId) p.classGroupId = 'Choose a class.';
    const phone = form.guardianPhone.replace(/[\s-]/g, '');
    if (phone && !KENYAN_PHONE.test(phone)) p.guardianPhone = 'A Kenyan mobile number, like 0712 345 678.';
    if (form.guardianEmail.trim() && !EMAIL.test(form.guardianEmail.trim())) p.guardianEmail = 'Enter a valid email, or leave it empty.';
    setProblems(p);
    return Object.keys(p).length === 0;
  }

  async function save() {
    setError(null);
    if (!check()) return;
    setBusy(true);
    const phone = form.guardianPhone.replace(/[\s-]/g, '');
    try {
      if (isNew) {
        const created = await enrolStudent(form.classGroupId, { ...form, guardianPhone: phone });
        await onSaved(null, `${created.fullName} enrolled in ${created.className}, card ${created.cardUid}`);
      } else {
        const patch = {};
        if (form.fullName.trim() !== student.fullName) patch.fullName = form.fullName.trim();
        if (form.admissionNo.trim() !== (student.admissionNo ?? '')) patch.admissionNo = form.admissionNo.trim();
        if (phone !== (student.guardianPhone ?? '')) patch.guardianPhone = phone || null;
        if (form.guardianEmail.trim() !== (student.guardianEmail ?? '')) patch.guardianEmail = form.guardianEmail.trim() || null;
        if (form.classGroupId !== student.classGroupId) patch.classGroupId = form.classGroupId;
        if (Object.keys(patch).length === 0) { onClose(); return; }
        const updated = await updateStudent(student.studentId, patch);
        await onSaved(null, patch.classGroupId ? `${updated.fullName} moved to ${updated.className}` : `${updated.fullName} saved`);
      }
    } catch (err) {
      setError(err.message ?? 'Could not save');
      setBusy(false);
    }
  }

  async function runConfirmed() {
    setBusy(true);
    setError(null);
    try {
      if (confirm === 'remove') {
        await updateStudent(student.studentId, { active: false });
        setConfirm(null);
        await onSaved(null, `${student.fullName} removed. Their attendance history is kept.`);
      } else if (confirm === 'restore') {
        const restored = await updateStudent(student.studentId, { active: true });
        setConfirm(null);
        await onSaved(null, `${student.fullName} is back in ${restored.className}`);
      } else {
        const updated = await reissueCard(student.studentId);
        setConfirm(null);
        await onSaved(updated, `New card number for ${updated.fullName}: ${updated.cardUid}`);
        setBusy(false);
      }
    } catch (err) {
      setConfirm(null);
      setError(err.message ?? 'Could not save');
      setBusy(false);
    }
  }

  const field = (name, label, props = {}, optional = false) => (
    <div className={`sys-field${problems[name] ? ' sys-field--error' : ''}`}>
      <label className="sys-field__label" htmlFor={`st-${name}`}>{label}{optional && <span className="sys-muted"> (optional)</span>}</label>
      <input id={`st-${name}`} className="sys-input" value={form[name]} onChange={set(name)} disabled={busy || (student && !student.active)} {...props} />
      {problems[name] && <p className="sys-field__error">{problems[name]}</p>}
    </div>
  );

  const removed = student && !student.active;
  return (
    <Drawer
      title={isNew ? 'Add student' : student.fullName}
      subtitle={!isNew && (removed ? 'Removed from the school' : `${student.className} · card ${student.cardUid ?? 'none'}`)}
      onClose={onClose}
      busy={busy}
      footer={removed ? (
        <button type="button" className="sys-btn sys-btn--primary" onClick={() => setConfirm('restore')} disabled={busy}>Restore student</button>
      ) : (
        <>
          <button type="button" className="sys-btn sys-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="sys-btn sys-btn--primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add student' : 'Save changes'}
          </button>
        </>
      )}
    >
      {error && <div className="sys-banner sys-banner--error" role="alert">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        {field('fullName', 'Full name', { autoFocus: isNew, autoComplete: 'off' })}
        {field('admissionNo', 'Admission number', {}, true)}
        <div className={`sys-field${problems.classGroupId ? ' sys-field--error' : ''}`}>
          <label className="sys-field__label" htmlFor="st-class">Class</label>
          <select id="st-class" className="sys-input" value={form.classGroupId} onChange={set('classGroupId')} disabled={busy || removed}>
            <option value="">Select class</option>
            {classes.map((c) => <option key={c.classGroupId} value={c.classGroupId}>{classLabel(c)}</option>)}
          </select>
          {!isNew && form.classGroupId !== student.classGroupId && <p className="sys-field__hint">Saving moves the student. Their attendance history moves with them.</p>}
          {problems.classGroupId && <p className="sys-field__error">{problems.classGroupId}</p>}
        </div>
        {field('guardianPhone', 'Guardian phone', { type: 'tel', inputMode: 'tel', placeholder: '07XX XXX XXX' }, true)}
        {field('guardianEmail', 'Guardian email', { type: 'email', inputMode: 'email' }, true)}
        <button type="submit" hidden>Save</button>
      </form>

      {isNew && <p className="sys-note">A card number is issued when you add the student. Print their ID card from the student list.</p>}

      {!isNew && !removed && (
        <section className="sys-detail">
          <h3 className="sys-detail__title">ID card</h3>
          <div className="sys-detail__row"><dt>Card number</dt><dd className="sys-mono">{student.cardUid ?? 'none'}</dd></div>
          <div className="sys-inline-actions">
            <button type="button" className="sys-btn sys-btn--secondary sys-btn--sm" onClick={() => onPrintCard(student)} disabled={busy || !student.cardUid}>Print card</button>
            <button type="button" className="sys-btn sys-btn--secondary sys-btn--sm" onClick={() => setConfirm('card')} disabled={busy}>Lost card: new number</button>
          </div>
          <h3 className="sys-detail__title sys-detail__title--danger">Remove</h3>
          <p className="sys-note">For a student who has left the school. Their attendance history is kept and you can restore them.</p>
          <button type="button" className="sys-btn sys-btn--danger sys-btn--sm" onClick={() => setConfirm('remove')} disabled={busy}>Remove student</button>
        </section>
      )}

      {confirm && (
        <ConfirmDialog
          tone={confirm === 'remove' ? 'danger' : 'primary'}
          title={{
            remove: `Remove ${student.fullName}?`,
            restore: `Restore ${student.fullName}?`,
            card: `Give ${student.fullName} a new card number?`,
          }[confirm]}
          body={{
            remove: `They will disappear from ${student.className}'s register on the teacher's phone. Their attendance history is kept.`,
            restore: `They go back into ${student.className}.`,
            card: `The old card (${student.cardUid}) stops working at once. Print and laminate the new card.`,
          }[confirm]}
          confirmLabel={{ remove: 'Remove', restore: 'Restore', card: 'Issue new number' }[confirm]}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={runConfirmed}
        />
      )}
    </Drawer>
  );
}

/** Import a class list from a CSV file (Excel: File > Save As > CSV). */
function ImportDialog({ classes, defaultClassId, onClose, onImported }) {
  const [classGroupId, setClassGroupId] = useState(defaultClassId ?? '');
  const [parsed, setParsed] = useState(null); // { fileName, students, problems }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function readFile(file) {
    setError(null);
    if (!file) return setParsed(null);
    if (/\.xlsx?$/i.test(file.name)) {
      setParsed(null);
      return setError('That is an Excel file. In Excel, choose File > Save As > CSV, then pick the .csv file here.');
    }
    const result = studentsFromCsv(await readText(file));
    setParsed({ fileName: file.name, ...result });
    return undefined;
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const created = await importStudents(classGroupId, parsed.students);
      onImported(created, classes.find((c) => c.classGroupId === classGroupId));
    } catch (err) {
      setError(err.message ?? 'Could not import the students');
      setBusy(false);
    }
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(STUDENT_CSV_TEMPLATE)}`;
  return (
    <ConfirmDialog
      tone="primary"
      title="Import students from a CSV file"
      body="One student per row. The first row must be headings: Name, and optionally Admission No, Guardian Phone and Guardian Email. Nothing is saved if any row has a problem."
      confirmLabel={parsed?.students.length ? `Add ${parsed.students.length} student${parsed.students.length === 1 ? '' : 's'}` : 'Add students'}
      confirmDisabled={!classGroupId || !parsed || parsed.students.length === 0 || parsed.problems.length > 0}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={save}
    >
      <div className="sa-field">
        <label className="sa-field__label" htmlFor="imp-class">Class</label>
        <select id="imp-class" className="sa-field__input sa-field__input--line" value={classGroupId} onChange={(e) => setClassGroupId(e.target.value)} disabled={busy}>
          {classes.map((c) => <option key={c.classGroupId} value={c.classGroupId}>{classLabel(c)}</option>)}
        </select>
      </div>
      <div className="sa-field">
        <label className="sa-field__label" htmlFor="imp-file">CSV file</label>
        <input id="imp-file" type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} disabled={busy} />
        <p className="sys-note"><a href={templateHref} download="students-template.csv">Download a template</a></p>
      </div>
      {parsed && parsed.problems.length > 0 && (
        <div className="sa-alert sa-alert--error sa-alert--compact" role="alert">
          <div>
            <b>Fix these rows in the file, then choose it again:</b>
            <ul className="sys-problems">{parsed.problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul>
            {parsed.problems.length > 8 && <div>…and {parsed.problems.length - 8} more.</div>}
          </div>
        </div>
      )}
      {parsed && parsed.problems.length === 0 && parsed.students.length > 0 && (
        <p className="sys-note">
          {parsed.students.length} student{parsed.students.length === 1 ? '' : 's'} found in {parsed.fileName}, starting with{' '}
          {parsed.students.slice(0, 3).map((s) => s.fullName).join(', ')}.
        </p>
      )}
    </ConfirmDialog>
  );
}
