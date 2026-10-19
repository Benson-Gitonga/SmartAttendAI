/**
 * The message a school admin sends a teacher with their one-time code, and
 * links that open WhatsApp, SMS or email on the admin's own phone with it
 * filled in. Nothing is sent by SmartAttend itself, so it costs nothing.
 */

/** 0712345678 or +254712345678 -> 254712345678, for wa.me links. */
export function internationalPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  return digits;
}

export function joinLink(code, origin = window.location.origin) {
  return `${origin}/#/join/${code}`;
}

export function inviteMessage({ fullName, schoolName, code, expiresAt, purpose = 'invite', origin }) {
  const until = new Date(expiresAt).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' });
  const link = joinLink(code, origin);
  const first = String(fullName ?? '').trim() || 'there';
  return purpose === 'reset'
    ? `Hi ${first}, here is a code to reset your SmartAttend password for ${schoolName}: ${code}\n\nOpen ${link} and choose a new password. The code works once, until ${until}.`
    : `Hi ${first}, you have been added to SmartAttend for ${schoolName}.\n\nOpen ${link} to set your password, or open SmartAttend, tap "I have an invite code" and enter: ${code}\n\nThe code works once, until ${until}.`;
}

/** { whatsapp, sms, email } hrefs with the message filled in. */
export function shareLinks({ phone, email, subject, message }) {
  const text = encodeURIComponent(message);
  const wa = internationalPhone(phone);
  return {
    whatsapp: wa ? `https://wa.me/${wa}?text=${text}` : `https://wa.me/?text=${text}`,
    // "?&body=" works on both Android and iPhone.
    sms: `sms:${phone ?? ''}?&body=${text}`,
    email: `mailto:${email ?? ''}?subject=${encodeURIComponent(subject)}&body=${text}`,
  };
}
