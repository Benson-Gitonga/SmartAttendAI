import { useEffect, useRef, useState } from 'react';
import { useWakeLock } from '../hooks/useWakeLock';

const SAME_CODE_PAUSE_MS = 5000;
const FEEDBACK_MS = 2500;
const MARK = { ok: '✓', info: 'i', error: '!' };

/**
 * Reads student ID cards (QR code or Code 128 barcode) with the device
 * camera, using ZXing. The library is loaded only when the camera opens, so
 * it does not slow down the rest of the app. Calls onCode once per card;
 * holding the same card in view is not counted twice. The caller answers with
 * `feedback` ({ id, tone, title, text }), shown large over the camera so it
 * can be read from a distance. The screen stays on while this is open.
 */
export default function CameraScanner({ onCode, onClose, hint = 'Hold the student’s card in the frame.', title = 'Scan cards', progress = null, feedback = null }) {
  const videoRef = useRef(null);
  const onCodeRef = useRef(onCode);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);
  const [dismissedId, setDismissedId] = useState(null);

  useWakeLock();
  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = setTimeout(() => setDismissedId(feedback.id), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    let controls = null;
    let cancelled = false;
    const last = { text: null, at: 0 };

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (result) => {
            if (!result) return;
            const text = result.getText().trim().toUpperCase();
            const now = Date.now();
            if (text === last.text && now - last.at < SAME_CODE_PAUSE_MS) return;
            last.text = text;
            last.at = now;
            onCodeRef.current(text);
          }
        );
        if (cancelled) controls.stop();
        else setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        setError(err?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow the camera for this site in the browser settings, then try again.'
          : err?.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : 'The camera could not start. Use a USB barcode scanner, or mark students by hand.');
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  const shown = feedback && feedback.id !== dismissedId ? feedback : null;

  return (
    <div className="camscan" role="dialog" aria-modal="true" aria-label="Scan cards with the camera">
      <div className="camscan__top">
        <span className="camscan__title">{title}</span>
        {progress && <span className="camscan__progress">{progress}</span>}
      </div>
      <div className="camscan__frame">
        <video ref={videoRef} className="camscan__video" muted playsInline />
        {!error && <div className={`camscan__target${shown ? ` camscan__target--${shown.tone}` : ''}`} aria-hidden="true" />}
        {starting && !error && <p className="camscan__msg">Starting the camera…</p>}
        {error && <p className="camscan__msg camscan__msg--error" role="alert">{error}</p>}
        <div className="camscan__live" role="status" aria-live="assertive">
          {shown ? (
            <div key={shown.id} className={`camscan__result camscan__result--${shown.tone}`}>
              <span className="camscan__mark" aria-hidden="true">{MARK[shown.tone]}</span>
              <div className="camscan__words">
                <div className="camscan__name">{shown.title}</div>
                <div className="camscan__text">{shown.text}</div>
              </div>
            </div>
          ) : !starting && !error && <span className="camscan__ready">Ready for the next card</span>}
        </div>
      </div>
      <div className="camscan__bar">
        <span>{hint}</span>
        <button type="button" className="sys-btn sys-btn--secondary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
