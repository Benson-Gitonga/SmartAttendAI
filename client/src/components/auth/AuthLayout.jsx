import { useState } from 'react';
import ThemeToggle from '../ThemeToggle';
import { BrandCheckIcon, RosterIcon, SyncIcon, BellIcon } from '../icons';

const HERO_POINTS = [
  { icon: RosterIcon, title: 'Register in seconds', text: 'Tick present or absent, or scan student ID cards.' },
  { icon: SyncIcon, title: 'Works without internet', text: 'Saved on the phone and sent once back online.' },
  { icon: BellIcon, title: 'Early warning', text: 'Students starting to miss school are flagged early.' },
];

/** The brand link opens the front page without reloading the app. */
function goToFrontPage(e) {
  e.preventDefault();
  window.history.pushState(null, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
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
            <p className="pub-hero__eyebrow">School attendance system</p>
            <h2 className="pub-hero__title">Daily attendance for Kenyan secondary schools</h2>
            <p className="pub-hero__lead">One place for teachers and the school office to keep track of who is in class.</p>
            <ul className="pub-hero__points">
              {HERO_POINTS.map(({ icon: Icon, title, text }) => (
                <li key={title}>
                  <span className="pub-hero__icon" aria-hidden="true"><Icon size={18} /></span>
                  <span className="pub-hero__point">
                    <b>{title}</b>
                    <span>{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="pub-hero__foot">© {year} SmartAttend</p>
        </aside>
      )}
      <div className="pub-side">
        <header className="pub-top">
          <a className="pub-brand" href="/" onClick={goToFrontPage}>SmartAttend</a>
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
