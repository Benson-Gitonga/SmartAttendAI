import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getTeachers } from '../../services/adminService';
import Avatar from '../Avatar';
import { MailIcon, PhoneIcon, UsersIcon } from '../icons';

const classLabel = (c) => [c.grade, c.stream].filter(Boolean).join(' ') || 'Class';

const lastSeen = (sqlite) => {
  if (!sqlite) return 'Has not signed in yet';
  const d = new Date(`${String(sqlite).replace(' ', 'T')}Z`);
  return `Last signed in ${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`;
};

/** The school's teachers and which classes each one teaches. */
export default function AdminTeachers({ onOpenClass }) {
  const { user } = useAuth();
  const schoolId = user?.schoolId;
  const [teachers, setTeachers] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    try {
      setTeachers(await getTeachers(schoolId));
      setError(null);
    } catch (err) {
      setError(err.message ?? 'Could not load the teachers');
    }
  }, [schoolId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="ad-page">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">Teachers</h2>
          <p className="page-head__sub">Everyone who teaches at your school, and the classes you have given them.</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn btn--sm" disabled title="Coming next">+ Invite teacher</button>
        </div>
      </div>

      <div className="notice notice--info">
        Inviting teachers is the next step: you will add a teacher&apos;s name and email and give them a one-time code
        to set their password. Until then, teacher accounts come from the demo data.
      </div>

      {error && <div className="notice notice--err" role="alert">{error}</div>}
      {!error && teachers === null && <p className="empty">Loading teachers…</p>}

      {teachers && teachers.length === 0 && (
        <div className="ad-empty">
          <span className="ad-empty__icon"><UsersIcon size={24} /></span>
          <p className="ad-empty__title">No teachers yet</p>
          <p className="ad-empty__text">Once teachers are invited, you will assign them classes here and under Classes.</p>
        </div>
      )}

      {teachers && teachers.length > 0 && (
        <div className="ad-people">
          {teachers.map((t) => (
            <article key={t.userId} className={`ad-person${t.status === 'disabled' ? ' ad-person--off' : ''}`}>
              <div className="ad-person__head">
                <Avatar name={t.fullName} size="md" />
                <div className="ad-person__id">
                  <span className="ad-person__name">{t.fullName}</span>
                  <span className="ad-person__meta">{t.jobTitle || 'Teacher'} · {lastSeen(t.lastSignInAt)}</span>
                </div>
                {t.status === 'disabled' && <span className="pill pill--absent">Disabled</span>}
              </div>
              <div className="ad-person__contact">
                <a href={`mailto:${t.email}`}><MailIcon size={14} /> {t.email}</a>
                {t.phone && <a href={`tel:${t.phone}`}><PhoneIcon size={14} /> {t.phone}</a>}
              </div>
              <div className="ad-person__classes">
                {t.classes.length === 0 ? (
                  <span className="ad-person__none">No classes yet. Assign one under Classes.</span>
                ) : (
                  t.classes.map((c) => (
                    <button key={c.classGroupId} type="button" className="ad-class-chip" onClick={() => onOpenClass(c.classGroupId)}>
                      {classLabel(c)}
                    </button>
                  ))
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
