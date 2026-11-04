import { useEffect, useRef, useState } from 'react';
import { useWakeLock } from '../hooks/useWakeLock';

// A card held in view is read once; scanning it again after this pause shows
// the caller's answer again (e.g. "Already scanned") instead of nothing.
const SAME_CODE_PAUSE_MS = 3000;
const FEEDBACK_MS = 2500;
const SCAN_EVERY_MS = 150;
const MARK = { ok: '✓', info: 'i', error: '!' };

/**
 * Back camera at a size where a card's QR code and barcode stay sharp, with
 * continuous autofocus where the phone allows it. The browser's default
 * (often 640×480, fixed focus) made cards hard to read.
 */
async function openCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  const [track] = stream.getVideoTracks();
  const caps = track?.getCapabilities?.() ?? {};
  if (caps.focusMode?.includes('continuous')) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }
  return { stream, track, canTorch: Boolean(caps.torch) };
}

/** The phone's own barcode reader (Android Chrome), or null if there is none. */
async function nativeDetector() {
  if (typeof window.BarcodeDetector === 'undefined') return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = ['qr_code', 'code_128'].filter((f) => supported.includes(f));
    return formats.includes('qr_code') ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

/** Reads frames with the native detector; returns a stop function. */
function readNative(detector, video, onText) {
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2) {
      try {
        const codes = await detector.detect(video);
        const text = codes.find((c) => c.rawValue)?.rawValue;
        if (text && !stopped) onText(text);
      } catch { /* frame not ready; try the next one */ }
    }
    if (!stopped) timer = setTimeout(tick, SCAN_EVERY_MS);
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

/** Reads frames with ZXing (iPhone and older phones); returns a stop function. */
async function readZxing(stream, video, onText) {
  const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  // Only the two formats printed on the cards: far less work per frame.
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]]]);
  const reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: SCAN_EVERY_MS,
    delayBetweenScanSuccess: SCAN_EVERY_MS,
  });
  const controls = await reader.decodeFromStream(stream, video, (result) => {
    if (result) onText(result.getText());
  });
  return () => controls.stop();
}

/**
 * Reads student ID cards (QR code or Code 128 barcode) with the device
 * camera: the phone's built-in reader where there is one, ZXing otherwise
 * (loaded only when the camera opens). Calls onCode once per card; holding
 * the same card in view is not counted twice. The caller answers with
 * `feedback` ({ id, tone, title, text }), shown large over the camera so it
 * can be read from a distance. The screen stays on while this is open.
 */
export default function CameraScanner({ onCode, onClose, hint = 'Hold the student’s card in the frame.', title = 'Scan cards', progress = null, feedback = null }) {
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const onCodeRef = useRef(onCode);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);
  const [dismissedId, setDismissedId] = useState(null);
  const [canTorch, setCanTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useWakeLock();
  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = setTimeout(() => setDismissedId(feedback.id), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    let cancelled = false;
    let stream = null;
    let stopReading = null;
    const last = { text: null, at: 0 };

    const onText = (raw) => {
      const text = raw.trim().toUpperCase();
      const now = Date.now();
      if (!text || (text === last.text && now - last.at < SAME_CODE_PAUSE_MS)) return;
      last.text = text;
      last.at = now;
      onCodeRef.current(text);
    };

    (async () => {
      try {
        const camera = await openCamera();
        stream = camera.stream;
        // Closed while the camera was starting: cleanup has already run.
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        trackRef.current = camera.track;
        setCanTorch(camera.canTorch);

        const video = videoRef.current;
        const detector = await nativeDetector();
        if (cancelled) return;
        if (detector) {
          video.srcObject = stream;
          await video.play();
          stopReading = readNative(detector, video, onText);
        } else {
          stopReading = await readZxing(stream, video, onText);
        }
        if (cancelled) stopReading();
        else setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        setError(err?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow the camera for this site in the browser settings, then try again.'
          : err?.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : 'The camera could not start. Close this and mark students by hand.');
      }
    })();

    return () => {
      cancelled = true;
      stopReading?.();
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, []);

  async function toggleTorch() {
    const next = !torchOn;
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setCanTorch(false);
    }
  }

  const shown = feedback && feedback.id !== dismissedId ? feedback : null;

  return (
    <div className="camscan" role="dialog" aria-modal="true" aria-label="Scan cards with the camera">
      <div className="camscan__top">
        <span className="camscan__title">{title}</span>
        <div className="camscan__tools">
          {canTorch && (
            <button type="button" className="camscan__torch" aria-pressed={torchOn} onClick={toggleTorch}>
              {torchOn ? 'Light off' : 'Light on'}
            </button>
          )}
          {progress && <span className="camscan__progress">{progress}</span>}
        </div>
      </div>
      <div className="camscan__frame">
        <video ref={videoRef} className="camscan__video" muted playsInline autoPlay />
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
