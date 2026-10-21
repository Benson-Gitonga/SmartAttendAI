/**
 * The account emails, each with a fresh link where one is needed. Kept apart
 * from the routes so the same email goes out whichever action triggers it.
 * Every function resolves to { sent } and never throws on a mail failure.
 */

import { emailLink, EMAIL_TOKEN_TTL_MS } from '../auth/emailTokens.js';
import { issueEmailToken, getSchool, getSchoolAdmins, findUserForReset } from '../db/repository.js';
import {
  confirmApplicationEmail, schoolApprovedEmail, schoolRejectedEmail, teacherInviteEmail, passwordResetEmail,
} from './templates.js';

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {ReturnType<import('./mailer.js').createMailer>} opts.mailer
 * @param {string} opts.appUrl
 */
export function createAccountEmails({ db, mailer, appUrl }) {
  const link = (userId, purpose, ttlMs = EMAIL_TOKEN_TTL_MS[purpose]) => {
    const { token } = issueEmailToken(db, { userId, purpose, ttlMs });
    return emailLink(appUrl, purpose, token);
  };
  const send = (to, message) => mailer.send({ to, ...message });

  /** Right after applying: confirm the address. */
  function applicationConfirmation(user, school) {
    return send(user.email, confirmApplicationEmail({
      fullName: user.fullName, schoolName: school.name, link: link(user.userId, 'verify_email'),
    }));
  }

  /** On approval: each admin without a password gets a set-up link; the rest a sign-in link. */
  async function schoolApproved(schoolId) {
    const school = getSchool(db, schoolId);
    const results = [];
    for (const admin of getSchoolAdmins(db, schoolId)) {
      if (admin.status === 'disabled') continue;
      results.push(await send(admin.email, schoolApprovedEmail({
        fullName: admin.fullName,
        schoolName: school.name,
        link: admin.hasPassword ? null : link(admin.userId, 'setup'),
        signInLink: `${appUrl}/`,
      })));
    }
    return { sent: results.length > 0 && results.every((r) => r.sent) };
  }

  async function schoolRejected(schoolId, reason) {
    const school = getSchool(db, schoolId);
    const results = [];
    for (const admin of getSchoolAdmins(db, schoolId)) {
      results.push(await send(admin.email, schoolRejectedEmail({ fullName: admin.fullName, schoolName: school.name, reason })));
    }
    return { sent: results.length > 0 && results.every((r) => r.sent) };
  }

  /** A teacher's invite, with the admin-visible code as a fallback. */
  function teacherInvite(teacher, { invitedBy, code } = {}) {
    const school = getSchool(db, teacher.schoolId);
    return send(teacher.email, teacherInviteEmail({
      fullName: teacher.fullName, schoolName: school?.name ?? 'your school', invitedBy, code, link: link(teacher.userId, 'setup', EMAIL_TOKEN_TTL_MS.invite),
    }));
  }

  function passwordReset(user) {
    return send(user.email, passwordResetEmail({ fullName: user.fullName, link: link(user.userId, 'reset') }));
  }

  /**
   * "Forgot password" for any school staff email. Sends whatever gets that
   * person in: a reset link, their set-up link again, or the confirmation link
   * again for an application still waiting. Unknown or disabled emails, and
   * applicants whose school is not approved yet (once confirmed), get nothing.
   * The caller answers the same way in every case.
   */
  function passwordHelp(email) {
    const user = findUserForReset(db, email);
    if (!user || user.status === 'disabled') return Promise.resolve({ sent: false, reason: 'no_account' });
    if (user.hasPassword) return passwordReset(user);
    // No password yet: an invited teacher, or an applicant.
    if (user.role === 'admin' && user.schoolStatus === 'pending') {
      if (user.emailVerifiedAt) return Promise.resolve({ sent: false, reason: 'awaiting_review' });
      return applicationConfirmation(user, { name: user.schoolName });
    }
    if (user.schoolStatus !== 'active') return Promise.resolve({ sent: false, reason: 'school_not_active' });
    return user.role === 'teacher' ? teacherInvite(user) : schoolApproved(user.schoolId);
  }

  return { applicationConfirmation, schoolApproved, schoolRejected, teacherInvite, passwordReset, passwordHelp };
}
