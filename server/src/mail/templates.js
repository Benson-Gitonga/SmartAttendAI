/**
 * The emails SmartAttend sends. Each returns { subject, text, html, link }.
 * Plain wording, one button, and the link also written out for mail apps
 * that strip buttons.
 */

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ greeting, paragraphs, button, link, footer }) {
  const text = [
    greeting,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(link ? [`${button}: ${link}`, ''] : []),
    footer ?? 'SmartAttend',
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1f2328">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e5e8;border-radius:6px">
<tr><td style="padding:20px 28px;border-bottom:1px solid #e3e5e8;font-weight:bold;font-size:16px">SmartAttend</td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.5">
<p style="margin:0 0 16px">${escape(greeting)}</p>
${paragraphs.map((p) => `<p style="margin:0 0 16px">${escape(p)}</p>`).join('\n')}
${link ? `<p style="margin:24px 0"><a href="${escape(link)}" style="display:inline-block;background:#0b5cd5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:bold">${escape(button)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#59636e">If the button does not work, copy this link into your browser:<br><a href="${escape(link)}" style="color:#0b5cd5;word-break:break-all">${escape(link)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e3e5e8;font-size:12px;color:#818b98">${escape(footer ?? 'You are getting this email because of an account on SmartAttend.')}</td></tr>
</table></td></tr></table></body></html>`;

  return { text, html };
}

const firstName = (fullName) => String(fullName ?? '').replace(/^(Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+/i, '').split(/\s+/)[0] || 'there';

/** After a school applies: confirm the email address before the review. */
export function confirmApplicationEmail({ fullName, schoolName, link }) {
  return {
    subject: `Confirm your email for ${schoolName}'s SmartAttend application`,
    link,
    ...layout({
      greeting: `Hello ${firstName(fullName)},`,
      paragraphs: [
        `Thank you for applying to use SmartAttend at ${schoolName}.`,
        'Please confirm this is your email address. We review applications once the email is confirmed, and we will write to you here with the decision.',
        'The link works for 7 days.',
      ],
      button: 'Confirm email address',
      link,
      footer: 'If you did not apply, you can ignore this email.',
    }),
  };
}

/** The school was approved: the applicant sets up their admin account. */
export function schoolApprovedEmail({ fullName, schoolName, link, signInLink }) {
  const needsSetup = Boolean(link);
  return {
    subject: `${schoolName} is approved on SmartAttend`,
    link: link ?? signInLink,
    ...layout({
      greeting: `Hello ${firstName(fullName)},`,
      paragraphs: [
        `Good news: ${schoolName} has been approved and is now live on SmartAttend.`,
        needsSetup
          ? 'Set a password for your school admin account to get started. You can then add classes and students and invite your teachers. The link works for 3 days; after that, use "Forgot password" on the sign-in page.'
          : 'Sign in with your email and password to add classes and students and invite your teachers.',
      ],
      button: needsSetup ? 'Set up your account' : 'Sign in',
      link: link ?? signInLink,
    }),
  };
}

export function schoolRejectedEmail({ fullName, schoolName, reason }) {
  return {
    subject: `Your SmartAttend application for ${schoolName}`,
    link: null,
    ...layout({
      greeting: `Hello ${firstName(fullName)},`,
      paragraphs: [
        `We have reviewed the application for ${schoolName} and are not able to approve it.`,
        `Reason: ${reason}`,
        'If you think this is a mistake, or the details have changed, you are welcome to apply again.',
      ],
    }),
  };
}

/** A school admin invited a teacher. The code is the fallback for teachers who cannot open the link. */
export function teacherInviteEmail({ fullName, schoolName, invitedBy, link, code }) {
  return {
    subject: `${schoolName} invited you to SmartAttend`,
    link,
    ...layout({
      greeting: `Hello ${firstName(fullName)},`,
      paragraphs: [
        `${invitedBy ? `${invitedBy} has` : 'Your school admin has'} added you as a teacher at ${schoolName} on SmartAttend, where you take your class register.`,
        'Set a password to finish setting up your account. The link works for 7 days.',
        ...(code ? [`Or open SmartAttend, choose "I have an invite code" and enter: ${code}`] : []),
      ],
      button: 'Set up your account',
      link,
    }),
  };
}

export function passwordResetEmail({ fullName, link }) {
  return {
    subject: 'Reset your SmartAttend password',
    link,
    ...layout({
      greeting: `Hello ${firstName(fullName)},`,
      paragraphs: [
        'Someone asked to reset the password for your SmartAttend account. If it was you, choose a new password with the link below. It works for 1 hour and only once.',
        'If you did not ask for this, ignore this email. Your password stays the same.',
      ],
      button: 'Choose a new password',
      link,
    }),
  };
}
