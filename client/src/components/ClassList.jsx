import { useEffect, useState } from 'react';
import { getStudentsByClass } from '../db/database';
import Avatar from './Avatar';
import { SearchIcon, PhoneIcon } from './icons';

/**
 * The teacher's class list, read-only: the school admin enrols, moves and
 * removes students, and the list comes down to this phone with the classes.
 */
export default function ClassList({ classGroupId, className, onOpenProfile }) {
  const [students, setStudents] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    getStudentsByClass(classGroupId).then((list) => { if (!cancelled) setStudents(list); });
    return () => { cancelled = true; };
  }, [classGroupId]);

  const q = query.trim().toLowerCase();
  const visible = (students ?? []).filter((s) => !q || s.fullName.toLowerCase().includes(q) || (s.admissionNo ?? '').toLowerCase().includes(q));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">Students</h2>
          <p className="page-head__sub">
            {students ? `${students.length} in ${className}. ` : ''}
            Your school admin adds, moves and removes students. Ask them if someone is missing or should not be here.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel__toolbar">
          <div className="search">
            <SearchIcon size={16} />
            <input type="search" placeholder="Search by name or admission no." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search students" />
          </div>
        </div>
        {students === null && <p className="empty">Loading…</p>}
        {students && visible.length === 0 && (
          <p className="empty">{q ? `No students match “${query.trim()}”.` : 'No students in this class yet. Your school admin adds them.'}</p>
        )}
        <ul className="classlist">
          {visible.map((s) => (
            <li key={s.studentId} className="classlist__item">
              <button type="button" className="classlist__row" onClick={() => onOpenProfile?.(s.studentId)}>
                <Avatar name={s.fullName} size="sm" />
                <span className="classlist__text">
                  <span className="classlist__name">{s.fullName}</span>
                  <span className="classlist__sub">{s.admissionNo || 'No admission no.'}{s.cardUid ? ` · card ${s.cardUid}` : ''}</span>
                </span>
              </button>
              {s.guardianPhone && (
                <a className="classlist__call" href={`tel:${s.guardianPhone}`} aria-label={`Call ${s.fullName}'s guardian`}>
                  <PhoneIcon size={16} />
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
