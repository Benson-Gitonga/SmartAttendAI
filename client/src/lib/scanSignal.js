/** Sound and vibration for a card scan, so staff at a gate need not watch the screen. */

// [frequency in Hz, seconds], played one after the other.
const TONES = {
  ok: [[880, 0.12]],
  info: [[660, 0.09], [660, 0.09]],
  error: [[220, 0.3]],
};
const VIBRATION = { ok: 60, info: [50, 60, 50], error: 300 };
const GAP_SECONDS = 0.05;

let audio = null;

function beep(tone) {
  const AudioContext = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContext) return;
  audio ??= new AudioContext();
  audio.resume?.();
  let at = audio.currentTime;
  for (const [frequency, seconds] of TONES[tone] ?? TONES.ok) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.2;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + seconds);
    at += seconds + GAP_SECONDS;
  }
}

/** @param {'ok'|'info'|'error'} tone */
export function signalScan(tone) {
  navigator.vibrate?.(VIBRATION[tone] ?? VIBRATION.ok);
  try {
    beep(tone);
  } catch { /* a scan still counts without sound */ }
}
