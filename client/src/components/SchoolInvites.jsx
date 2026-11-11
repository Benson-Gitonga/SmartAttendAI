import { useState } from 'react';
import { createSchoolInvite, revokeSchoolInvite } from '../services/systemAdminService';
import { schoolInviteMessage, shareLinks, joinLink } from '../lib/inviteMessage';
import { showToast } from '../lib/toast';
import ConfirmDialog from './ConfirmDialog';
import { MailIcon, CheckCircleIcon, XCircleIcon } from './icons';

/**
 * The system admin's invite codes for new schools. Whoever sets up a school
 * with one skips the review queue: the school is approved at once, and its
 * admin can invite teachers straight away.
 */

const STATE_LABEL = { ok: 'Waiting', used: 'Used', revoked: 'Cancelled', expired: 'Expired' };
const STATE_TONE = { ok: 'pending', used: 'active', revoked: 'inactive', expired: 'inactive' };

const formatDate = (value) => {
  if (!value) return null;
  // SQLite datetime('now') is UTC without a zone marker; expiresAt is ISO.
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The list of invites under the school table. */
export function SchoolInviteList({ invites, onRevoked, onUnauthorized }) {
  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeSchoolInvite(revoking.id);
      showToast('Invite code cancelled');
      setRevoking(null);
      await onRevoked();
    } catch (err) {
      if (onUnauthorized(err)) return;
      setError(err.message ?? 'Could not cancel the invite');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sys-panel sys-invites" aria-labelledby="sys-invites-title">
      <div className="sys-toolbar">
        <h2 id="sys-invites-title" className="sys-invites__title">School invite codes</h2>
        <span className="sys-toolbar__count">Schools set up with a code are approved at once</span>
      </div>
      <table className="sys-table">
        <thead>
          <tr>
            <th>For</th>
            <th>Created</th>
            <th>Expires</th>
            <th>Status</th>
            <th className="sys-table__actions"><span className="sa-visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {invites.length === 0 && (
            <tr><td colSpan={5} className="sys-table__empty">No invite codes yet. Use “Invite a school” to create one.</td></tr>
          )}
          {invites.map((inv) => (
            <tr key={inv.id}>
              <td data-label="For">
                {inv.registeredSchoolName ?? inv.schoolName ?? <span className="sys-muted">Any school</span>}
                {(inv.email || inv.note) && <div className="sys-table__sub">{[inv.email, inv.note].filter(Boolean).join(' · ')}</div>}
              </td>
              <td data-label="Created" className="sys-nowrap">
                {formatDate(inv.createdAt) ?? '-'}
                {inv.createdBy && <div className="sys-table__sub">by {inv.createdBy}</div>}
              </td>
              <td data-label="Expires" className="sys-nowrap">{inv.state === 'used' ? '-' : formatDate(inv.expiresAt) ?? '-'}</td>
              <td data-label="Status">
                <span className={`sys-status sys-status--${STATE_TONE[inv.state]}`}>{STATE_LABEL[inv.state] ?? inv.state}</span>
                {inv.state === 'used' && inv.usedAt && <div className="sys-table__sub">{formatDate(inv.usedAt)}</div>}
              </td>
              <td className="sys-table__actions">
                {inv.state === 'ok' && (
                  <button type="button" className="sys-btn sys-btn--sm sys-btn--secondary" onClick={() => setRevoking(inv)}>Cancel code</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {revoking && (
        <ConfirmDialog
          tone="danger"
          Icon={XCircleIcon}
          title="Cancel this invite code?"
          body="Nobody will be able to set up a school with it. You can create a new one at any time."
          confirmLabel="Yes, cancel it"
          cancelLabel="Keep it"
          busy={busy}
          error={error}
          onCancel={() => { setRevoking(null); setError(null); }}
          onConfirm={revoke}
        />
      )}
    </section>
  );
}

/** "Invite a school": optional details, then the new code with ways to send it. */
export function InviteSchoolDialog({ onClose, onCreated, onUnauthorized }) {
  const [schoolName, setSchoolName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const invite = await createSchoolInvite({ schoolName, email, note });
      setIssued(invite);
      await onCreated();
    } catch (err) {
      if (onUnauthorized(err)) return;
      setError(err.message ?? 'Could not create the invite');
    } finally {
      setBusy(false);
    }
  }

  if (issued) return <IssuedInviteDialog invite={issued} onClose={onClose} />;

  return (
    <ConfirmDialog
      tone="primary"
      Icon={MailIcon}
      title="Invite a school"
      body="You get a one-time code to send. Whoever sets up a school with it skips the review queue: the school is approved at once."
      confirmLabel="Create invite code"
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={create}
    >
      <div className="sa-field">
        <label className="sa-field__label" htmlFor="si-school">School name <span className="field__opt">(optional, filled in for them)</span></label>
        <input id="si-school" className="sa-field__input" value={schoolName} onChange={(e) => setSchoolName(e.target.value)}
          placeholder="e.g. Benson Secondary School" maxLength={120} disabled={busy} autoFocus />
      </div>
      <div className="sa-field">
        <label className="sa-field__label" htmlFor="si-email">Their email <span className="field__opt">(optional, only this email can use the code)</span></label>
        <input id="si-email" className="sa-field__input" type="email" inputMode="email" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="principal@school.ac.ke" maxLength={254} disabled={busy} />
      </div>
      <div className="sa-field">
        <label className="sa-field__label" htmlFor="si-note">Note for yourself <span className="field__opt">(optional)</span></label>
        <input id="si-note" className="sa-field__input" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Met at the county heads' meeting" maxLength={200} disabled={busy} />
      </div>
    </ConfirmDialog>
  );
}

/** The new code, shown once, with WhatsApp, SMS, email and copy. */
function IssuedInviteDialog({ invite, onClose }) {
  const message = schoolInviteMessage(invite);
  const links = shareLinks({ email: invite.email, subject: 'Set up your school on SmartAttend', message });

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
      title="Invite code ready"
      body="Send it now. This is the only time the code is shown. It works once, for 7 days."
      confirmLabel="Done"
      hideCancel
      onCancel={onClose}
      onConfirm={onClose}
    >
      <p className="sys-invite-code" aria-label="Invite code">{invite.code}</p>
      <div className="ad-share">
        <a className="ad-share__btn ad-share__btn--wa" href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="ad-share__btn" href={links.sms}>SMS</a>
        <a className="ad-share__btn" href={links.email}>Email</a>
        <button type="button" className="ad-share__btn" onClick={() => copy(joinLink(invite.code), 'Link')}>Copy link</button>
        <button type="button" className="ad-share__btn" onClick={() => copy(invite.code, 'Code')}>Copy code</button>
      </div>
    </ConfirmDialog>
  );
}
