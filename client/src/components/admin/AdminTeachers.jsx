import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { getTeachers, inviteTeacher, newTeacherCode, setTeacherEnabled } from '../../services/adminService';
import { inviteMessage, shareLinks, joinLink } from '../../lib/inviteMessage';
import { showToast } from '../../lib/toast';
import ConfirmDialog from '../ConfirmDialog';
import Avatar from '../Avatar';
import { MailIcon, PhoneIcon, UsersIcon, PowerIcon, CheckCircleIcon } from '../icons';

const KENYAN_PHONE = /^(\+254|0)[17]\d{8}$/;
const classLabel = (c) => [c.grade, c.stream].filter(Boolean).join(' ') || 'Class';
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

const lastSeen = (sqlite) => {
  if (!sqlite) return 'Has not signed in yet';
  const d = new Date(`${String(sqlite).replace(' ', 'T')}Z`);
  return `Last signed in ${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`;
};

const STATUS = {
  active: null,
  invited: { label: 'Invited', tone: 'late' },
  disabled: { label: 'Disabled', tone: 'absent' },
};

/** The school's teachers: invite them, send a new link, disable or enable them. */
export default function AdminTeachers({ onOpenClass }) {
  const { user } = useAuth();
  const schoolId = user?.schoolId;
  const [teachers, setTeachers] = useState(null);
  const [error, setError] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState(null); // { teacher, code, expiresAt, purpose } to show once
  const [toggling, setToggling] = useState(null); // teacher to disable or enable

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

  async function giveNewCode(teacher) {
    try {
      setIssued(await newTeacherCode(teacher.userId));
      await load();
    } catch (err) {
      showToast(err.message ?? 'Could not make a new link', { tone: 'error' });
    }
  }

  const invitedCount = (teachers ?? []).filter((t) => t.status === 'invited').length;

  return (
    <div className="ad-page">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">Teachers</h2>
          <p className="page-head__sub">
            Invite your teachers, then give them classes under <b>Classes</b>.
            {invitedCount > 0 && ` ${invitedCount} still to accept ${invitedCount === 1 ? 'their invite' : 'their invites'}.`}
          </p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn btn--sm" onClick={() => setInviting(true)}>+ Invite teacher</button>
        </div>
      </div>

      {error && <div className="notice notice--err" role="alert">{error}</div>}
      {!error && teachers === null && <p className="empty">Loading teachers…</p>}

      {teachers && teachers.length === 0 && (
        <div className="ad-empty">
          <span className="ad-empty__icon"><UsersIcon size={24} /></span>
          <p className="ad-empty__title">No teachers yet</p>
          <p className="ad-empty__text">Invite a teacher with their name and email. They get a link to set up their account.</p>
          <button type="button" className="btn btn--sm" onClick={() => setInviting(true)}>+ Invite teacher</button>
        </div>
      )}

      {teachers && teachers.length > 0 && (
        <div className="ad-people">
          {teachers.map((t) => {
            const badge = STATUS[t.status];
            return (
              <article key={t.userId} className={`ad-person${t.status === 'disabled' ? ' ad-person--off' : ''}`}>
                <div className="ad-person__head">
                  <Avatar name={t.fullName} size="md" />
                  <div className="ad-person__id">
                    <span className="ad-person__name">{t.fullName}</span>
                    <span className="ad-person__meta">
                      {t.status === 'invited'
                        ? t.openCode && !t.openCode.expired
                          ? `Invite sent · link works until ${shortDate(t.openCode.expiresAt)}`
                          : 'Invite link has expired'
                        : lastSeen(t.lastSignInAt)}
                    </span>
                  </div>
                  {badge && <span className={`pill pill--${badge.tone}`}>{badge.label}</span>}
                </div>
                <div className="ad-person__contact">
                  <a href={`mailto:${t.email}`}><MailIcon size={14} /> {t.email}</a>
                  {t.phone && <a href={`tel:${t.phone}`}><PhoneIcon size={14} /> {t.phone}</a>}
                  {t.googleEmail && <span title="Signs in with this Google account">Google: {t.googleEmail}</span>}
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
                <div className="ad-person__actions">
                  {t.status !== 'disabled' && (
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => giveNewCode(t)}>
                      <MailIcon size={15} /> {t.status === 'invited' ? 'Send new link' : 'Reset password'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn btn--sm ${t.status === 'disabled' ? 'btn--outline' : 'btn--ghost ad-danger-text'}`}
                    onClick={() => setToggling(t)}
                  >
                    <PowerIcon size={15} /> {t.status === 'disabled' ? 'Enable' : 'Disable'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {inviting && (
        <InviteDialog
          schoolId={schoolId}
          onClose={() => setInviting(false)}
          onInvited={async (result) => {
            setInviting(false);
            setIssued(result);
            await load();
          }}
        />
      )}

      {issued && <LinkDialog issued={issued} schoolName={user?.schoolName} onClose={() => setIssued(null)} />}

      {toggling && (
        <ConfirmDialog
          tone={toggling.status === 'disabled' ? 'success' : 'danger'}
          Icon={PowerIcon}
          title={toggling.status === 'disabled'
            ? `Enable ${toggling.fullName} again?`
            : `Are you sure you want to disable ${toggling.fullName}?`}
          body={toggling.status === 'disabled'
            ? 'They can sign in again.'
            : 'They will be signed out straight away.'}
          confirmLabel={toggling.status === 'disabled' ? 'Yes, enable' : 'Yes, disable'}
          onCancel={() => setToggling(null)}
          onConfirm={async () => {
            const t = toggling;
            setToggling(null);
            try {
              await setTeacherEnabled(t.userId, t.status === 'disabled');
              showToast(t.status === 'disabled' ? `${t.fullName} is enabled` : `${t.fullName} is disabled`);
              await load();
            } catch (err) {
              showToast(err.message ?? 'Could not change this teacher', { tone: 'error' });
            }
          }}
        />
      )}
    </div>
  );
}

function InviteDialog({ schoolId, onClose, onInvited }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cleanPhone = phone.replace(/[\s-]/g, '');

  async function send() {
    if (cleanPhone && !KENYAN_PHONE.test(cleanPhone)) {
      setError('Enter a Kenyan mobile number like 0712 345 678, or leave it empty.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onInvited(await inviteTeacher(schoolId, { fullName: fullName.trim(), email: email.trim(), phone: cleanPhone }));
    } catch (err) {
      setError(err.status === 409 ? 'This email already has a SmartAttend account.' : err.message ?? 'Could not invite this teacher');
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      tone="primary"
      Icon={UsersIcon}
      title="Invite a teacher"
      body="They get an email with a link to set up their account."
      confirmLabel="Create invite"
      busy={busy}
      error={error}
      confirmDisabled={fullName.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
      onCancel={onClose}
      onConfirm={send}
    >
      <div className="sa-field ad-dialog-row">
        <label className="sa-field__label" htmlFor="inv-name">Full name</label>
        <input id="inv-name" className="sa-field__input sa-field__input--line" placeholder="e.g. Ms. Mary Otieno"
          value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} autoFocus />
      </div>
      <div className="sa-field ad-dialog-row">
        <label className="sa-field__label" htmlFor="inv-email">Email</label>
        <input id="inv-email" className="sa-field__input sa-field__input--line" type="email" inputMode="email"
          placeholder="teacher@school.ac.ke" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      </div>
      <div className="sa-field ad-dialog-row">
        <label className="sa-field__label" htmlFor="inv-phone">Phone <span className="field__opt">(for WhatsApp or SMS)</span></label>
        <input id="inv-phone" className="sa-field__input sa-field__input--line" type="tel" inputMode="tel"
          placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
      </div>
    </ConfirmDialog>
  );
}

/** The new set-up link, with ways to send it. */
function LinkDialog({ issued, schoolName, onClose }) {
  const { teacher, code, expiresAt, purpose, emailSent } = issued;
  const message = inviteMessage({ fullName: teacher.fullName, schoolName: schoolName || 'your school', code, expiresAt, purpose });
  const links = shareLinks({
    phone: teacher.phone,
    email: teacher.email,
    subject: purpose === 'reset' ? 'Reset your SmartAttend password' : 'Your SmartAttend invite',
    message,
  });

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${what} copied`);
    } catch {
      showToast('Could not copy. Select the text and copy it instead.', { tone: 'error' });
    }
  }

  return (
    <ConfirmDialog
      tone="success"
      Icon={CheckCircleIcon}
      title={purpose === 'reset' ? `Password reset for ${teacher.fullName}` : `${teacher.fullName} is invited`}
      body={emailSent ? 'We emailed them a link. You can also send it yourself.' : 'Send them this link.'}
      confirmLabel="Done"
      hideCancel
      onCancel={onClose}
      onConfirm={onClose}
    >
      <div className="ad-share">
        <a className="ad-share__btn ad-share__btn--wa" href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="ad-share__btn" href={links.sms}>SMS</a>
        <a className="ad-share__btn" href={links.email}>Email</a>
        <button type="button" className="ad-share__btn" onClick={() => copy(joinLink(code), 'Link')}>Copy link</button>
      </div>
    </ConfirmDialog>
  );
}
