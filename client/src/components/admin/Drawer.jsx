import { useEffect } from 'react';

/** A panel that slides in from the right, for adding or editing one record. Escape closes it. */
export default function Drawer({ title, subtitle, onClose, footer, children, busy = false }) {
  useEffect(() => {
    const onKey = (e) => {
      // A confirm dialog on top handles its own Escape.
      if (e.key === 'Escape' && !busy && !document.querySelector('[role="dialog"][aria-modal="true"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <>
      <div className="sys-drawer-backdrop" onClick={busy ? undefined : onClose} role="presentation" />
      <aside className="sys-drawer" aria-label={title}>
        <header className="sys-drawer__head">
          <div>
            <h2 className="sys-drawer__title">{title}</h2>
            {subtitle && <div className="sys-drawer__sub">{subtitle}</div>}
          </div>
          <button type="button" className="sys-drawer__close" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
        </header>
        <div className="sys-drawer__body">{children}</div>
        {footer && <footer className="sys-drawer__foot">{footer}</footer>}
      </aside>
    </>
  );
}
