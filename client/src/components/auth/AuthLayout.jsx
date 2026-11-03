import { useState } from 'react';
import ThemeToggle from '../ThemeToggle';
import { BrandCheckIcon } from '../icons';

const HERO_POINTS = [
  { title: 'Register in seconds', text: 'Tick the class register, or let students scan their ID cards at the gate.' },
  { title: 'Works without internet', text: 'Records are kept on the device and sync when the connection returns.' },
  { title: 'Early warnings', text: 'Students at risk of persistent absence are flagged so you can follow up early.' },
];

/** Picture of a register for the brand panel. Placeholder bars, not real data. */
function RegisterIllustration() {
  const rows = [true, true, false, true, true];
  return (
    <div className="pub-hero__art" aria-hidden="true">
      <div className="pub-hero__sheet">
        <div className="pub-hero__sheet-head">
          <span className="pub-hero__bar pub-hero__bar--title" />
          <span className="pub-hero__pill">Today</span>
        </div>
        {rows.map((present, i) => (
          <div key={i} className="pub-hero__row">
            <span className={`pub-hero__tick${present ? '' : ' pub-hero__tick--off'}`}>{present ? '✓' : ''}</span>
            <span className="pub-hero__avatar" />
            <span className="pub-hero__bar" style={{ width: `${46 + ((i * 17) % 30)}%` }} />
            <span className={`pub-hero__status${present ? '' : ' pub-hero__status--absent'}`}>{present ? 'Present' : 'Absent'}</span>
          </div>
        ))}
      </div>
      <div className="pub-hero__card">
        <span className="pub-hero__card-chip" />
        <span className="pub-hero__card-lines"><span /><span /></span>
        <span className="pub-hero__qr" />
      </div>
    </div>
  );
}

/**
 * Page frame for every signed-out screen. Short forms get the split layout
 * most school systems use: a brand panel on the left (desktop only) and the
 * form on the right. `wide` pages (the school application) keep one centred card.
 */
export default function AuthLayout({ children, wide = false, aside = null }) {
  const year = new Date().getFullYear();
  return (
    <div className={`pub${wide ? '' : ' pub--split'}`}>
      {!wide && (
        <aside className="pub-hero">
          <div className="pub-hero__brand">
            <span className="pub-hero__logo" aria-hidden="true"><BrandCheckIcon size={28} /></span>
            <span>SmartAttend</span>
          </div>
          <div className="pub-hero__body">
            <h2 className="pub-hero__title">Daily attendance for Kenyan secondary schools</h2>
            <RegisterIllustration />
            <ul className="pub-hero__points">
              {HERO_POINTS.map((p) => (
                <li key={p.title}>
                  <span className="pub-hero__check" aria-hidden="true">✓</span>
                  <span><b>{p.title}.</b> {p.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="pub-hero__foot">© {year} SmartAttend</p>
        </aside>
      )}
      <div className="pub-side">
        <header className="pub-top">
          <a className="pub-brand" href="#/">SmartAttend</a>
          <ThemeToggle compact />
        </header>
        <main className={`pub-main${aside ? ' pub-main--aside' : ''}`}>
          {aside}
          <div className={`pub-card${wide ? ' pub-card--wide' : ''}`}>{children}</div>
        </main>
        <footer className="pub-foot">
          {wide ? 'School attendance for Kenyan secondary schools' : 'Need help signing in? Ask your school administrator.'}
        </footer>
      </div>
    </div>
  );
}

/** Label + input, with an optional hint and inline error. */
export function Field({ id, label, optional = false, hint, error, children }) {
  return (
    <div className={`pub-field${error ? ' pub-field--error' : ''}`}>
      <label className="pub-field__label" htmlFor={id}>
        {label}{optional && <span className="pub-field__opt"> (optional)</span>}
      </label>
      {children}
      {hint && !error && <p className="pub-field__hint">{hint}</p>}
      {error && <p className="pub-field__error">{error}</p>}
    </div>
  );
}

/** Password input with a Show/Hide text button, as most sign-in pages have. */
export function PasswordInput({ id, value, onChange, autoComplete = 'current-password', disabled, autoFocus, placeholder }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pub-password">
      <input
        id={id}
        className="pub-input"
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
      />
      <button type="button" className="pub-password__toggle" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function Alert({ tone = 'error', children }) {
  return <div className={`pub-alert pub-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}
