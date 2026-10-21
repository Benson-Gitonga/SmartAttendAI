import { useEffect, useState } from 'react';
import AuthLayout, { Alert } from './AuthLayout';
import { PUBLIC_PAGES } from './publicRoute';

/**
 * Development only: the emails the server would have sent (MAIL_TRANSPORT=log),
 * so the links in them can be followed without a mail provider.
 */
export default function DevOutbox() {
  const [emails, setEmails] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const res = await fetch('/api/dev/outbox');
      if (!res.ok) throw new Error(res.status === 404 ? 'The server is sending real email (or is in production), so there is no outbox.' : `Server answered ${res.status}`);
      setEmails((await res.json()).emails);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <AuthLayout wide>
      <a className="pub-back" href={PUBLIC_PAGES.signin}>← Back to sign in</a>
      <div className="pub-row">
        <h1 className="pub-title">Dev outbox</h1>
        <button type="button" className="pub-btn pub-btn--secondary" onClick={load}>Refresh</button>
      </div>
      <p className="pub-sub">Emails the server would have sent. Real email goes out once SES is set up.</p>
      {error && <Alert>{error}</Alert>}
      {emails?.length === 0 && <p className="pub-sub">No emails yet.</p>}
      <ul className="pub-outbox">
        {(emails ?? []).map((m) => (
          <li key={`${m.at}-${m.to}-${m.subject}`}>
            <div className="pub-outbox__meta">{new Date(m.at).toLocaleString('en-KE')} · to {m.to}</div>
            <div className="pub-outbox__subject">{m.subject}</div>
            {m.link && <a className="pub-link" href={m.link.replace(/^https?:\/\/[^/]+\/?/, `${window.location.origin}/`)}>Open link</a>}
            <details><summary>Show email</summary><pre>{m.text}</pre></details>
          </li>
        ))}
      </ul>
    </AuthLayout>
  );
}
