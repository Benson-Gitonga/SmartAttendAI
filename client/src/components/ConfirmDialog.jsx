import { useEffect, useRef } from 'react';
import { AlertTriangleIcon } from './icons';
import { useBackToClose } from '../hooks/useBackToClose';

/**
 * "Are you sure?" dialog. Centred on a desktop, a bottom sheet on a phone.
 * Escape and a click outside cancel (unless it is busy saving). `tone` colours
 * the icon and the confirm button: 'danger' (red), 'success' (green) or
 * 'primary' (blue). Extra fields, such as a reason box, go in `children`.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  Icon = AlertTriangleIcon,
  busy = false,
  error = null,
  confirmDisabled = false,
  // For a dialog that only informs: one button, and closing it any way is fine.
  hideCancel = false,
  onConfirm,
  onCancel,
  children,
}) {
  const cancelRef = useRef(null);
  // The back button cancels, like Escape. Not while saving.
  useBackToClose(busy ? null : onCancel);

  useEffect(() => {
    // Start on Cancel, so a stray Enter never confirms something destructive.
    // A field inside the dialog with autoFocus takes focus instead.
    if (!children) cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel, children]);

  return (
    <div className="sa-dialog-backdrop" onClick={busy ? undefined : onCancel} role="presentation">
      <form
        className="sa-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={body ? 'confirm-dialog-body' : undefined}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !confirmDisabled) onConfirm();
        }}
      >
        <span className={`sa-dialog__icon sa-dialog__icon--${tone}`}><Icon size={22} /></span>
        <h2 className="sa-dialog__title" id="confirm-dialog-title">{title}</h2>
        {body && <p className="sa-dialog__body" id="confirm-dialog-body">{body}</p>}

        {error && <div className="sa-alert sa-alert--error sa-alert--compact" role="alert">{error}</div>}
        {children}

        <div className="sa-dialog__actions">
          {!hideCancel && (
            <button ref={cancelRef} type="button" className="sa-btn sa-btn--ghost" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
          )}
          <button type="submit" className={`sa-btn sa-btn--${tone}`} disabled={busy || confirmDisabled}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
