import { inviteMessage, shareLinks, internationalPhone, joinLink } from './inviteMessage';

describe('invite messages', () => {
  const base = { fullName: 'Mr. Kamau', schoolName: 'Kibera Secondary School', code: 'K7QM-4XPA', expiresAt: '2026-10-26T09:00:00Z', origin: 'https://app.smartattend.ke' };

  it('includes the school, the code, a link and how long it lasts', () => {
    const text = inviteMessage(base);
    expect(text).toContain('Kibera Secondary School');
    expect(text).toContain('K7QM-4XPA');
    expect(text).toContain('https://app.smartattend.ke/#/join/K7QM-4XPA');
    expect(text).toContain('I have an invite code');
    expect(text).toMatch(/until/);
  });

  it('a reset message talks about the password, not joining', () => {
    expect(inviteMessage({ ...base, purpose: 'reset' })).toMatch(/reset your SmartAttend password/);
  });

  it('turns Kenyan numbers into the form WhatsApp links need', () => {
    expect(internationalPhone('0712 345 678')).toBe('254712345678');
    expect(internationalPhone('+254712345678')).toBe('254712345678');
    expect(internationalPhone('')).toBe('');
  });

  it('builds WhatsApp, SMS and email links, with or without a phone', () => {
    const withPhone = shareLinks({ phone: '0712345678', email: 'k@s.ke', subject: 'Invite', message: 'Hi & welcome' });
    expect(withPhone.whatsapp).toBe('https://wa.me/254712345678?text=Hi%20%26%20welcome');
    expect(withPhone.sms).toBe('sms:0712345678?&body=Hi%20%26%20welcome');
    expect(withPhone.email).toBe('mailto:k@s.ke?subject=Invite&body=Hi%20%26%20welcome');
    expect(shareLinks({ message: 'x', subject: 's' }).whatsapp).toBe('https://wa.me/?text=x');
  });

  it('the join link carries the code', () => {
    expect(joinLink('ABCD-EFGH', 'http://localhost:5173')).toBe('http://localhost:5173/#/join/ABCD-EFGH');
  });
});
