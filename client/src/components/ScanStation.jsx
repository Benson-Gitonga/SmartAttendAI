import { useCallback, useEffect, useRef, useState } from 'react';
import { stationScan } from '../services/adminService';
import { queueStationScan, getQueuedStationScans, removeQueuedStationScan } from '../db/database';
import CameraScanner from './CameraScanner';

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '');

// While scans wait offline, try sending them this often (and at once when the device comes back online).
const RETRY_MS = 20_000;

const RESULT = {
  recorded: { tone: 'ok', title: (r) => r.student.fullName, text: (r) => `${r.student.className} · marked present ${timeOf(r.mark.createdAt)}` },
  duplicate: { tone: 'info', title: (r) => r.student.fullName, text: (r) => `Already marked ${r.mark.status} today at ${timeOf(r.mark.createdAt)}` },
  queued: { tone: 'info', title: () => 'Saved on this device', text: (r) => `Card ${r.cardUid}. No connection: it is sent when you are back online.` },
  'unknown-card': { tone: 'error', title: () => 'Card not recognised', text: (r) => `${r.cardUid} is not an active card at this school. Check the card, or give the student a new one.` },
  error: { tone: 'error', title: () => 'Scan not saved', text: (r) => r.message },
};

const LOG_LABEL = { recorded: 'Present', duplicate: 'Already marked', queued: 'Waiting to send', 'unknown-card': 'Unknown card' };
const LOG_TONE = { recorded: 'active', duplicate: 'inactive', queued: 'pending' };

const isOffline = (err) => err?.code === 'NETWORK';

/**
 * A scan station for the gate or the office, run by the school admin or a
 * teacher on gate duty: a USB barcode scanner types the card number and Enter
 * into the box (it works like a keyboard), or the device camera reads the
 * card's QR code. Each card marks the student present for the day.
 *
 * Without a connection, scans are kept on this device with the time they
 * happened and sent once it is back online, so a dropped connection at the
 * gate loses nothing.
 */
export default function ScanStation() {
  const inputRef = useRef(null);
  const sendingRef = useRef(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState(null);
  const [log, setLog] = useState([]);
  const [camera, setCamera] = useState(false);
  const [waiting, setWaiting] = useState(0);

  // Keep the box focused so the scanner's keystrokes always land in it.
  useEffect(() => {
    if (camera) return undefined;
    const refocus = () => { if (document.activeElement?.tagName !== 'SELECT') inputRef.current?.focus(); };
    refocus();
    const timer = setInterval(refocus, 1500);
    return () => clearInterval(timer);
  }, [camera]);

  const addToLog = useCallback((result, key) => {
    const entry = { ...result, at: result.scannedAt ?? new Date().toISOString(), key };
    // A scan that was waiting replaces its "waiting to send" row.
    setLog((l) => [entry, ...l.filter((e) => e.key !== key)].slice(0, 50));
    return entry;
  }, []);

  const countWaiting = useCallback(async () => {
    setWaiting((await getQueuedStationScans()).length);
  }, []);

  /** Send the scans kept offline, oldest first. Stops at the first one that still cannot get through. */
  const sendWaiting = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      for (const scan of await getQueuedStationScans()) {
        let result;
        try {
          result = await stationScan(scan.cardUid, { scannedAt: scan.scannedAt });
        } catch (err) {
          if (isOffline(err)) break;
          result = { outcome: 'error', cardUid: scan.cardUid, message: err.message ?? 'The server refused the scan' };
        }
        await removeQueuedStationScan(scan.id);
        addToLog({ ...result, scannedAt: scan.scannedAt }, `queued-${scan.id}`);
      }
    } finally {
      sendingRef.current = false;
      await countWaiting();
    }
  }, [addToLog, countWaiting]);

  // Send what is waiting on open, when the device comes back online, and every so often while any wait.
  useEffect(() => {
    sendWaiting();
    window.addEventListener('online', sendWaiting);
    return () => window.removeEventListener('online', sendWaiting);
  }, [sendWaiting]);
  useEffect(() => {
    if (waiting === 0) return undefined;
    const timer = setInterval(sendWaiting, RETRY_MS);
    return () => clearInterval(timer);
  }, [waiting, sendWaiting]);

  async function scan(raw) {
    const cardUid = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cardUid) return;
    setBusy(true);
    let result;
    let key = `${Date.now()}-${cardUid}`;
    try {
      result = await stationScan(cardUid);
    } catch (err) {
      if (isOffline(err)) {
        const kept = await queueStationScan(cardUid);
        key = `queued-${kept.id}`;
        result = { outcome: 'queued', cardUid, scannedAt: kept.scannedAt };
        await countWaiting();
      } else {
        result = { outcome: 'error', cardUid, message: err.message ?? 'Could not save the scan' };
      }
    }
    const entry = addToLog(result, key);
    setLatest(entry);
    setBusy(false);
    const shown = RESULT[entry.outcome] ?? RESULT.error;
    return { tone: shown.tone, title: shown.title(entry), text: shown.text(entry) };
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

      {waiting > 0 && (
        <div className="sys-banner sys-banner--warn scanst-wait" role="status">
          <span>
            {waiting} scan{waiting === 1 ? '' : 's'} saved on this device, waiting for a connection. They are sent automatically.
          </span>
          <button type="button" className="sys-btn sys-btn--secondary sys-btn--sm" onClick={sendWaiting}>Send now</button>
        </div>
      )}

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
              {counts.recorded ?? 0} marked present · {counts.duplicate ?? 0} already marked
              {counts.queued ? ` · ${counts.queued} waiting to send` : ''}
              {' · '}{(counts['unknown-card'] ?? 0) + (counts.error ?? 0)} problems
            </span>
          </div>
          <table className="sys-table">
            <thead><tr><th>Time</th><th>Student</th><th>Result</th></tr></thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.key} className="is-static">
                  <td className="sys-nowrap">{timeOf(e.at)}</td>
                  <td>{e.student ? <>{e.student.fullName}<div className="sys-table__sub">{e.student.className}</div></> : <span className="sys-mono">{e.cardUid ?? '-'}</span>}</td>
                  <td><span className={`sys-status sys-status--${LOG_TONE[e.outcome] ?? 'rejected'}`}>{LOG_LABEL[e.outcome] ?? 'Not saved'}</span></td>
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
