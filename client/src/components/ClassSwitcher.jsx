import { useCallback, useEffect, useState } from 'react';
import { getClasses, getStudentsByClass, classLabel } from '../db/database';
import { useAuth } from '../auth/AuthContext';
import { useBackToClose } from '../hooks/useBackToClose';

/**
 * Switch between the classes the school admin assigned this teacher.
 * Teachers do not create classes; the school admin does.
 */
export default function ClassSwitcher({ activeClassId, onPick, onManageRoster, onClose }) {
  // The back button closes this sheet rather than leaving the page.
  useBackToClose(onClose);
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [counts, setCounts] = useState({});

  const load = useCallback(async () => {
    const list = await getClasses({ ownerUsername: user?.username, assignedOnly: true });
    setClasses(list);
    const entries = await Promise.all(
      list.map(async (c) => [c.classGroupId, (await getStudentsByClass(c.classGroupId)).length]),
    );
    setCounts(Object.fromEntries(entries));
  }, [user?.username]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-label="Classes" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="sheet__name">Your classes</div>
        <div className="sheet__sub">
          {classes.length} class{classes.length === 1 ? '' : 'es'} assigned to you by your school admin
        </div>

        {classes.map((c) => (
          <button
            key={c.classGroupId}
            type="button"
            className="class-row"
            aria-current={c.classGroupId === activeClassId ? 'true' : undefined}
            onClick={() => onPick(c.classGroupId)}
          >
            <span>
              <span className="class-row__name">{classLabel(c)}</span>
              <span className="class-row__meta">
                {counts[c.classGroupId] ?? 0} student{counts[c.classGroupId] === 1 ? '' : 's'}
                {c.academicYear ? ` · ${c.academicYear}` : ''}
              </span>
            </span>
            {c.classGroupId === activeClassId && <span className="class-row__tick">✓</span>}
          </button>
        ))}

        <div className="sheet__row" style={{ borderTop: '1px solid var(--line-soft)', marginTop: 8 }}>
          <span>Add / remove students in this class</span>
          <button type="button" className="linkbtn" onClick={onManageRoster}>Roster</button>
        </div>
        <p className="sheet__hint">Need another class? Ask your school admin to assign it to you.</p>
      </div>
    </div>
  );
}
