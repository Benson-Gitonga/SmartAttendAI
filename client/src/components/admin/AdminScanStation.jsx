import { useEffect, useRef, useState } from 'react';
import { stationScan } from '../../services/adminService';
import CameraScanner from '../CameraScanner';

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '');

const RESULT = {
  recorded: { tone: 'ok', title: (r) => r.student.fullName, text: (r) => `${r.student.className} · marked present ${timeOf(r.mark.createdAt)}` },
  duplicate: { tone: 'info', title: (r) => r.student.fullName, text: (r) => `Already marked ${r.mark.status} today at ${timeOf(r.mark.createdAt)}` },
  'unknown-card': { tone: 'error', title: () => 'Card not recognised', text: (r) => `${r.cardUid} is not an active card at this school. Check the card, or give the student a new one.` },
  error: { tone: 'error', title: () => 'Scan not saved', text: (r) => r.message },
};

/**
 * A scan station for the gate or the office: a USB barcode scanner types the
 * card number and Enter into the box (it works like a keyboard), or the
 * device camera reads the card's QR code. Each card marks the student present
 * for today. Needs a connection; it writes straight to the server.
 */
export default function AdminScanStation() {
  const inputRef = useRef(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState(null);
  const [log, setLog] = useState([]);
  const [camera, setCamera] = useState(false);

  // Keep the box focused so the scanner's keystrokes always land in it.
  useEffect(() => {
    if (camera) return undefined;
    const refocus = () => { if (document.activeElement?.tagName !== 'SELECT') inputRef.current?.focus(); };
    refocus();
    const timer = setInterval(refocus, 1500);
    return () => clearInterval(timer);
  }, [camera]);

  async function scan(raw) {
    const cardUid = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cardUid) return;
    setBusy(true);
    let result;
    try {
      result = await stationScan(cardUid);
    } catch (err) {
      result = { outcome: 'error', message: err.message ?? 'Could not reach the server' };
    }
    const entry = { ...result, at: new Date().toISOString(), key: `${Date.now()}-${cardUid}` };
    setLatest(entry);
    setLog((l) => [entry, ...l].slice(0, 50));
    setBusy(false);
  }

  const counts = log.reduce((c, e) => ({ ...c, [e.outcome]: (c[e.outcome] ?? 0) + 1 }), {});
  const shown = latest && RESULT[latest.outcome];

  return (
    <div className="ad-page ad-console">
      <div className="sys-pagehead">
        <div>
          <h1 className="sys-pagehead__title">Scan station</h1>
          <p className="sys-pagehead__sub">Scan student ID cards as they arrive. Each card marks the student present for today.</p>
        </div>
        <div className="sys-pagehead__actions">
          <button type="button" className="sys-btn sys-btn--secondary" onClick={() => setCamera(true)}>Use camera</button>
        </div>
      </div>

      <section className="sys-panel scanst">
        <form
          className="scanst__form"
          onSubmit={(e) => { e.preventDefault(); const v = code; setCode(''); scan(v); }}
        >
          <label className="sys-field__label" htmlFor="scan-input">Card number</label>
          <input
            id="scan-input"
            ref={inputRef}
            className="sys-input scanst__input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Scan a card, or type its number and press Enter"
            disabled={busy}
          />
        </form>

        <div className={`scanst__result${shown ? ` scanst__result--${shown.tone}` : ''}`} role="status" aria-live="polite">
          {shown ? (
            <>
              <div className="scanst__name">{shown.title(latest)}</div>
              <div className="scanst__text">{shown.text(latest)}</div>
            </>
          ) : (
            <div className="scanst__text">Waiting for the first card…</div>
          )}
        </div>
      </section>

      {log.length > 0 && (
        <section className="sys-panel">
          <div className="sys-toolbar">
            <span className="sys-toolbar__title">This session</span>
            <span className="sys-toolbar__count">
              {counts.recorded ?? 0} marked present · {counts.duplicate ?? 0} already marked · {(counts['unknown-card'] ?? 0) + (counts.error ?? 0)} problems
            </span>
          </div>
          <table className="sys-table">
            <thead><tr><th>Time</th><th>Student</th><th>Result</th></tr></thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.key} className="is-static">
                  <td className="sys-nowrap">{timeOf(e.at)}</td>
                  <td>{e.student ? <>{e.student.fullName}<div className="sys-table__sub">{e.student.className}</div></> : <span className="sys-mono">{e.cardUid ?? '-'}</span>}</td>
                  <td><span className={`sys-status sys-status--${{ recorded: 'active', duplicate: 'inactive' }[e.outcome] ?? 'rejected'}`}>{{ recorded: 'Present', duplicate: 'Already marked', 'unknown-card': 'Unknown card' }[e.outcome] ?? 'Not saved'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {camera && <CameraScanner onCode={scan} onClose={() => setCamera(false)} />}
    </div>
  );
}
