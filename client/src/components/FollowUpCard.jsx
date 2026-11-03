import { useCallback, useEffect, useState } from 'react';
import { getFollowUpsForStudent } from '../db/database';
import FollowUpPanel from './FollowUpPanel';
import { METHOD_LABEL } from '../lib/followUpLabels';
import Modal from './Modal';
import { CheckCircleIcon, PhoneIcon } from './icons';

function fmtAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * Follow-up summary card on the profile. The whole card opens a pop-up with
 * the guardian contact, the "log a follow-up" form and the history.
 */
export default function FollowUpCard({ studentId, student, flag, onStudentUpdated, onChanged }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setList(await getFollowUpsForStudent(studentId));
  }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    getFollowUpsForStudent(studentId).then((rows) => { if (!cancelled) setList(rows); });
    return () => { cancelled = true; };
  }, [studentId]);

  const latest = list?.[0];
  const openIt = () => setOpen(true);

  return (
    <>
      <section
        className="panel panel--pad click-card"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label="Follow up. Open to log a follow-up"
        onClick={openIt}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openIt();
          }
        }}
      >
        <h3 className="panel__title">Follow up</h3>
        {latest ? (
          <p className="fu-card__last">
            <CheckCircleIcon size={16} />
            <span>
              <b>{METHOD_LABEL[latest.method] ?? latest.method}</b> {fmtAgo(latest.createdAt)}
              {latest.note && <span className="fu-card__note">“{latest.note}”</span>}
            </span>
          </p>
        ) : (
          <p className="fu-card__none">Nobody has followed up with this student yet.</p>
        )}
        <p className="fu-card__contact">
          <PhoneIcon size={14} />
          {student.guardianPhone ? `Guardian: ${student.guardianPhone}` : 'No guardian contact on file'}
        </p>
        <span className="click-card__more">
          {latest ? `See all ${list.length} follow-up${list.length === 1 ? '' : 's'} or log another` : 'Log a follow-up'}
        </span>
      </section>

      {open && (
        <Modal
          eyebrow="Follow up"
          title={student.fullName}
          sub={student.admissionNo || '-'}
          labelId="followup-dialog-title"
          onClose={() => setOpen(false)}
        >
          <FollowUpPanel
            bare
            studentId={studentId}
            flag={flag}
            student={student}
            onStudentUpdated={onStudentUpdated}
            onLogged={() => { load(); onChanged?.(); }}
          />
        </Modal>
      )}
    </>
  );
}
