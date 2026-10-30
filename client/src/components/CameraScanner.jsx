import { useEffect, useRef, useState } from 'react';

const SAME_CODE_PAUSE_MS = 3000;
const RESULT_SHOW_MS = 2500;
const RESULT_ICON = { ok: '✓', error: '✕', info: 'i' };

/**
 * Reads student ID cards (QR code or Code 128 barcode) with the device
 * camera, using ZXing. The library is loaded only when the camera opens, so
 * it does not slow down the rest of the app. Calls onCode once per card;
 * holding the same card in view is not counted twice.
 *
 * onCode may return (or resolve to) { tone: 'ok' | 'info' | 'error', title,
 * text }: it is shown large over the camera for a moment, so the person
 * scanning sees the student was marked without closing the camera.
 */
export default function CameraScanner({ onCode, onClose, hint = 'Hold the student’s card in the frame.' }) {
  const videoRef = useRef(null);
  const onCodeRef = useRef(onCode);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);
  const [result, setResult] = useState(null);
  const resultTimer = useRef(null);

  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);
  useEffect(() => () => clearTimeout(resultTimer.current), []);

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
            navigator.vibrate?.(60);
            Promise.resolve(onCodeRef.current(text)).then((shown) => {
              if (cancelled || !shown) return;
              if (shown.tone === 'error') navigator.vibrate?.([80, 60, 80]);
              clearTimeout(resultTimer.current);
              setResult({ ...shown, key: now });
              resultTimer.current = setTimeout(() => setResult(null), RESULT_SHOW_MS);
            });
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

  return (
    <div className="camscan" role="dialog" aria-modal="true" aria-label="Scan cards with the camera">
      <div className="camscan__frame">
        <video ref={videoRef} className="camscan__video" muted playsInline />
        {!error && <div className="camscan__target" aria-hidden="true" />}
        {starting && !error && <p className="camscan__msg">Starting the camera…</p>}
        {error && <p className="camscan__msg camscan__msg--error" role="alert">{error}</p>}
        <div className="camscan__live" role="status" aria-live="assertive">
          {result && (
            <div key={result.key} className={`camscan__result camscan__result--${result.tone ?? 'ok'}`}>
              <span className="camscan__result-icon" aria-hidden="true">{RESULT_ICON[result.tone] ?? RESULT_ICON.ok}</span>
              <span className="camscan__result-title">{result.title}</span>
              {result.text && <span className="camscan__result-text">{result.text}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="camscan__bar">
        <span>{hint}</span>
        <button type="button" className="sys-btn sys-btn--secondary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
