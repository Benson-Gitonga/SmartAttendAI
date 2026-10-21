import { useState } from 'react';

/** Page frame for every signed-out screen: brand bar, one card, small footer. */
export default function AuthLayout({ children, wide = false }) {
  return (
    <div className="pub">
      <header className="pub-top">
        <a className="pub-brand" href="#/">SmartAttend</a>
      </header>
      <main className="pub-main">
        <div className={`pub-card${wide ? ' pub-card--wide' : ''}`}>{children}</div>
      </main>
      <footer className="pub-foot">
        School attendance for Kenyan secondary schools
      </footer>
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
