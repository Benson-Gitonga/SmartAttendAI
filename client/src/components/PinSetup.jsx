import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PIN_LENGTH } from '../auth/pin';
import { INACTIVITY_LOCK_MS } from '../auth/inactivity';

const LOCK_MINUTES = Math.round(INACTIVITY_LOCK_MS / 60000);
import { CapIcon } from './icons';

/**
 * Shown after the first online sign-in, and from the account sheet (with
 * `changing` and a `skipLabel`).
 */
export default function PinSetup({ onDone, onSkip, changing = false, skipLabel = 'Not now' }) {
  const { enrolPin } = useAuth();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (pin !== confirm) {
      setError('The two PINs do not match.');
      setConfirm('');
      return;
    }

    setBusy(true);
    try {
      await enrolPin(pin);
      onDone();
    } catch (err) {
      setError(
        err.code === 'TOO_WEAK'
          ? 'That PIN is too easy to guess. Avoid repeated digits and sequences like 1234.'
          : err.message ?? 'Could not save PIN'
      );
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={handleSubmit}>
        <div className="auth__logo"><CapIcon size={24} /></div>
        <h1 className="auth__brand">{changing ? 'Change your offline PIN' : 'Set an offline PIN'}</h1>
        <p className="auth__tagline">Keeps the register safe on a phone left unattended</p>
        <p className="auth__help">
          {changing
            ? `Choose a new ${PIN_LENGTH}-digit PIN. It replaces the current one on this device immediately.`
            : `SmartAttend locks after ${LOCK_MINUTES} minutes without use. Your ${PIN_LENGTH}-digit PIN
               opens it again, even with no network.`}
        </p>

        {error && <div className="notice notice--err" role="alert">{error}</div>}

        <div className="field">
          <label className="field__label" htmlFor="new-pin">Choose a PIN</label>
          <input
            id="new-pin"
            className="field__input field__input--pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={PIN_LENGTH}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="confirm-pin">Confirm PIN</label>
          <input
            id="confirm-pin"
            className="field__input field__input--pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={PIN_LENGTH}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
            disabled={busy}
          />
        </div>

        <button
          className="btn"
          type="submit"
          disabled={busy || pin.length !== PIN_LENGTH || confirm.length !== PIN_LENGTH}
        >
          {busy ? 'Saving…' : 'Save PIN'}
        </button>

        <div className="auth__foot">
          <button className="linkbtn" type="button" onClick={onSkip} disabled={busy}>
            {skipLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
