import { useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import { encodeCode128B } from '../../lib/code128';

/** The card number as Code 128 bars, for USB barcode scanners. */
function Barcode({ value }) {
  const { bars, width } = useMemo(() => encodeCode128B(value), [value]);
  return (
    <svg className="idcard__barcode" viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`}>
      {bars.map((b) => <rect key={b.x} x={b.x} y="0" width={b.w} height="40" />)}
    </svg>
  );
}

/** The card number as a QR code, which phone cameras read more easily. */
function QrCode({ value }) {
  const qr = useMemo(() => QRCode.create(value, { errorCorrectionLevel: 'M' }).modules, [value]);
  const cells = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.data[y * qr.size + x]) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" />);
    }
  }
  // A 2-module quiet zone around the code.
  return (
    <svg className="idcard__qr" viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} role="img" aria-label={`QR code ${value}`}>
      <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} fill="#fff" />
      {cells}
    </svg>
  );
}

/** One card, ID-card size (85.6 × 54 mm), to print, cut and laminate. */
export function StudentIdCard({ student, schoolName, year }) {
  return (
    <article className="idcard">
      <header className="idcard__head">
        <span className="idcard__school">{schoolName}</span>
        <span className="idcard__kind">Student ID {year}</span>
      </header>
      <div className="idcard__body">
        <div className="idcard__who">
          <div className="idcard__name">{student.fullName}</div>
          <dl className="idcard__facts">
            <div><dt>Adm. no.</dt><dd>{student.admissionNo || '-'}</dd></div>
            <div><dt>Class</dt><dd>{student.className || '-'}</dd></div>
          </dl>
        </div>
        {student.cardUid && <QrCode value={student.cardUid} />}
      </div>
      {student.cardUid ? (
        <footer className="idcard__foot">
          <Barcode value={student.cardUid} />
          <span className="idcard__number">{student.cardUid}</span>
        </footer>
      ) : (
        <footer className="idcard__foot idcard__foot--none">No card number yet</footer>
      )}
    </article>
  );
}

/**
 * A printable sheet of ID cards (10 per A4 page). Takes over the screen so
 * the browser prints only the cards.
 */
export default function StudentIdCards({ students, schoolName, title, onClose }) {
  const year = new Date().getFullYear();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="idsheet">
      <div className="idsheet__bar no-print">
        <div>
          <h1 className="idsheet__title">{title}</h1>
          <p className="idsheet__sub">
            {students.length} card{students.length === 1 ? '' : 's'}. Print on A4 at 100% (no “fit to page”), cut along
            the grey lines and laminate. The barcode and QR code both carry the card number.
          </p>
        </div>
        <div className="idsheet__actions">
          <button type="button" className="sys-btn sys-btn--secondary" onClick={onClose}>Close</button>
          <button type="button" className="sys-btn sys-btn--primary" onClick={() => window.print()} disabled={students.length === 0}>Print</button>
        </div>
      </div>
      <div className="idsheet__cards">
        {students.map((s) => <StudentIdCard key={s.studentId} student={s} schoolName={schoolName} year={year} />)}
      </div>
    </div>
  );
}
