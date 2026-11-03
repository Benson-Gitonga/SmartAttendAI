import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBackToClose } from '../hooks/useBackToClose';

/**
 * Centred pop-up (bottom sheet on phones). Closes with the × in the corner, Escape, a click
 * outside or the back button. Rendered on <body> so nothing on the page clips it.
 * Note: React still bubbles clicks from here to the component that rendered it,
 * so render it outside any clickable card.
 */
export default function Modal({ eyebrow, title, sub, badge, onClose, actions, children, labelId = 'modal-title' }) {
  useBackToClose(onClose);
  const box = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={box}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <div className="modal__titles">
            {eyebrow && <p className="modal__eyebrow">{eyebrow}</p>}
            <h2 id={labelId} className="modal__title">{title}</h2>
            {sub && <p className="modal__sub">{sub}</p>}
          </div>
          {badge}
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal__body">{children}</div>

        {actions && <footer className="modal__foot">{actions}</footer>}
      </div>
    </div>,
    document.body,
  );
}
