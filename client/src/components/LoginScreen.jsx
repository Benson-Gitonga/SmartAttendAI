import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  CapIcon, MailIcon, LockIcon, EyeIcon, EyeOffIcon, KeypadIcon, UserIcon,
  CheckCircleIcon, SyncIcon, BellIcon, BuildingIcon, ArrowRightIcon, ChevronLeftIcon,
} from './icons';
import { COUNTIES_AZ } from '../lib/counties';

// Same rules as the server's application schema (schemas/schoolRegistration.schema.js).
const KENYAN_PHONE = /^(\+254|0)[17]\d{8}$/;
const SCHOOL_CODE = /^[A-Za-z0-9-]{3,20}$/;
const PASSWORD_MIN = 8;

const JOB_TITLES = ['Principal', 'Deputy Principal', 'Director of Studies', 'Head of Department', 'School administrator', 'Other'];

const FEATURES = [
  { Icon: CheckCircleIcon, title: 'One-tap class register', text: 'Everyone starts present. Untick who is absent and save.' },
  { Icon: BellIcon, title: 'Early warning', text: 'An ML model flags students at risk of persistent absenteeism.' },
  { Icon: SyncIcon, title: 'Works offline', text: 'Records save on the device and sync when there is a connection.' },
];

const EMPTY_APPLICATION = {
  schoolName: '', county: '', subCounty: '', schoolCode: '', schoolType: '', boarding: '', studentEstimate: '',
  fullName: '', jobTitle: '', email: '', phone: '', password: '', confirm: '',
};

/** Check the application on the device first, with the same rules the server uses. */
function applicationProblem(a) {
  if (a.schoolName.trim().length < 3) return 'Enter the full name of the school.';
  if (!a.county) return 'Choose the county the school is in.';
  if (a.schoolCode.trim() && !SCHOOL_CODE.test(a.schoolCode.trim())) {
    return 'The school code should be letters and numbers only, like 20414001.';
  }
  if (a.studentEstimate && !(Number(a.studentEstimate) >= 1)) return 'Enter roughly how many students the school has, or leave it empty.';
  if (a.fullName.trim().length < 2) return 'Enter your full name.';
  const phone = a.phone.replace(/[\s-]/g, '');
  if (phone && !KENYAN_PHONE.test(phone)) return 'Enter a Kenyan mobile number like 0712 345 678, or leave the phone empty.';
  if (a.password.length < PASSWORD_MIN) return `Choose a password of at least ${PASSWORD_MIN} characters.`;
  if (a.password !== a.confirm) return 'The two passwords do not match.';
  return null;
}

/** The request body for POST /api/schools/register, leaving out empty answers. */
function toApplication(a) {
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
  return {
    school: clean({
      name: a.schoolName.trim(),
      county: a.county,
      subCounty: a.subCounty.trim(),
      schoolCode: a.schoolCode.trim().toUpperCase(),
      schoolType: a.schoolType,
      boarding: a.boarding,
      studentEstimate: a.studentEstimate ? Math.round(Number(a.studentEstimate)) : '',
    }),
    applicant: clean({
      fullName: a.fullName.trim(),
      jobTitle: a.jobTitle,
      email: a.email.trim(),
      phone: a.phone.replace(/[\s-]/g, ''),
      password: a.password,
    }),
  };
}

// The application has its own address, so the back button returns to sign-in
// and a refresh stays on the form. (#/register is the teachers' class register.)
const APPLY_HASH = '#/apply';
const viewFromHash = () => (typeof window !== 'undefined' && window.location.hash === APPLY_HASH ? 'register' : 'signin');

/**
 * Views: signin (everyone, including the system admin with their username)
 * and register (a school's application to join, made by its admin).
 */
export default function LoginScreen() {
  const { signIn, registerSchool } = useAuth();
  const online = useOnlineStatus();

  const [view, setView] = useState(viewFromHash);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [app, setApp] = useState(EMPTY_APPLICATION);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => setApp((a) => ({ ...a, [field]: e.target.value }));

  // Back and forward between sign-in and the application. Messages belong
  // to the view they were shown on, so they go only when the view changes.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    const onPop = () => {
      const next = viewFromHash();
      if (next === viewRef.current) return;
      setView(next);
      setError(null);
      setNotice(null);
      setBusy(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function switchView(next) {
    viewRef.current = next; // before the history change below fires popstate
    if (next === 'register' && window.location.hash !== APPLY_HASH) {
      window.history.pushState({ fromSignIn: true }, '', APPLY_HASH);
    } else if (next === 'signin' && window.location.hash === APPLY_HASH) {
      // Step back if we came from sign-in, so back does not reopen the form.
      if (window.history.state?.fromSignIn) window.history.back();
      else window.history.replaceState(null, '', '#/');
    }
    setView(next);
    setError(null);
    setNotice(null);
    setBusy(false);
    window.scrollTo?.(0, 0);
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err.message ?? 'Sign in failed');
      setBusy(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError(null);
    const problem = applicationProblem(app);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await registerSchool(toApplication(app));
    } catch (err) {
      if (err.code === 'CONFLICT' && err.field === 'email') {
        switchView('signin');
        setEmail(app.email.trim());
        setNotice(err.message);
        return;
      }
      setError(err.message ?? 'Could not send the application');
      setBusy(false);
    }
  }

  const revealBtn = (
    <button
      type="button"
      className="field__reveal"
      onClick={() => setReveal((r) => !r)}
      aria-label={reveal ? 'Hide password' : 'Show password'}
    >
      {reveal ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
    </button>
  );

  const offlineNotice = !online && (
    <div className="notice notice--warn" role="status">
      {view === 'signin'
        ? 'You’re offline. Sign in once with a connection; after that your PIN opens the app offline.'
        : 'You’re offline. Connect to the internet to send your application.'}
    </div>
  );

  return (
    <div className="auth auth--split">
      <aside className="auth__aside">
        <div className="auth__aside-brand">
          <span className="auth__aside-logo"><CapIcon size={20} /></span>
          SmartAttend
        </div>
        <div className="auth__aside-body">
          <h2 className="auth__aside-title">Attendance management for Kenyan secondary schools</h2>
          <ul className="auth__features">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title}>
                <span className="auth__feature-icon"><Icon size={18} /></span>
                <span>
                  <b>{title}</b>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth__aside-foot">SmartAttend AI</p>
      </aside>

      <main className="auth__main">
        {view === 'signin' && (
          <form className="auth__card" onSubmit={handleSignIn}>
            <div className="auth__logo"><CapIcon size={24} /></div>
            <h1 className="auth__brand">Welcome back</h1>
            <p className="auth__tagline">Sign in to your SmartAttend account</p>

            {offlineNotice}
            {error && <div className="notice notice--err" role="alert">{error}</div>}
            {notice && <div className="notice notice--info" role="status">{notice}</div>}

            <div className="field">
              <label className="field__label" htmlFor="email">Email or username</label>
              <div className="field__wrap">
                <span className="field__icon"><MailIcon size={18} /></span>
                <input
                  id="email"
                  className="field__input"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@school.ac.ke"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="password">Password</label>
              <div className="field__wrap">
                <span className="field__icon"><LockIcon size={18} /></span>
                <input
                  id="password"
                  className="field__input field__input--reveal"
                  type={reveal ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  required
                />
                {revealBtn}
              </div>
            </div>

            <button className="btn" type="submit" disabled={busy || !online}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="auth__register">
              <span className="auth__register-icon"><BuildingIcon size={20} /></span>
              <span className="auth__register-text">
                <b>New school?</b>
                <span>Apply to join SmartAttend. We review every school before it goes live.</span>
              </span>
              <button type="button" className="btn btn--sm btn--outline" onClick={() => switchView('register')}>
                Register your school <ArrowRightIcon size={14} />
              </button>
            </div>

            <p className="auth__offline">
              <KeypadIcon size={15} />
              <span>
                Teachers get their account from their school admin. No network? After you have signed
                in once, you can unlock the app with your offline PIN.
              </span>
            </p>
          </form>
        )}

        {view === 'register' && (
          <form className="auth__card auth__card--wide" onSubmit={handleRegister} noValidate>
            <button type="button" className="auth__back" onClick={() => switchView('signin')}>
              <ChevronLeftIcon size={16} /> Back to sign in
            </button>
            <h1 className="auth__brand">Register your school</h1>
            <p className="auth__tagline">
              Fill this in as the school’s administrator. The SmartAttend team checks every
              application; you can sign in straight away and watch for the decision.
            </p>

            {offlineNotice}
            {error && <div className="notice notice--err" role="alert">{error}</div>}

            <fieldset className="field-group">
              <legend className="field__label">The school</legend>

              <div className="field">
                <label className="field__label" htmlFor="rg-school">School name</label>
                <input id="rg-school" className="field__input" type="text" autoComplete="organization"
                  placeholder="e.g. Kisumu Day Secondary School" value={app.schoolName} onChange={set('schoolName')}
                  disabled={busy} required />
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="field__label" htmlFor="rg-county">County</label>
                  <select id="rg-county" className="field__input" value={app.county} onChange={set('county')} disabled={busy} required>
                    <option value="" disabled>Choose…</option>
                    {COUNTIES_AZ.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rg-subcounty">Sub-county <span className="field__opt">(optional)</span></label>
                  <input id="rg-subcounty" className="field__input" type="text" placeholder="e.g. Kisumu Central"
                    value={app.subCounty} onChange={set('subCounty')} disabled={busy} />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="field__label" htmlFor="rg-code">School code <span className="field__opt">(optional)</span></label>
                  <input id="rg-code" className="field__input" type="text" inputMode="numeric" placeholder="MoE / KNEC code"
                    value={app.schoolCode} onChange={set('schoolCode')} disabled={busy} />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rg-students">Students <span className="field__opt">(about)</span></label>
                  <input id="rg-students" className="field__input" type="number" min="1" inputMode="numeric" placeholder="e.g. 600"
                    value={app.studentEstimate} onChange={set('studentEstimate')} disabled={busy} />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="field__label" htmlFor="rg-type">Type</label>
                  <select id="rg-type" className="field__input" value={app.schoolType} onChange={set('schoolType')} disabled={busy}>
                    <option value="">Not sure</option>
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rg-boarding">Day or boarding</label>
                  <select id="rg-boarding" className="field__input" value={app.boarding} onChange={set('boarding')} disabled={busy}>
                    <option value="">Not sure</option>
                    <option value="day">Day</option>
                    <option value="boarding">Boarding</option>
                    <option value="mixed">Day and boarding</option>
                  </select>
                </div>
              </div>
            </fieldset>

            <fieldset className="field-group">
              <legend className="field__label">About you</legend>

              <div className="field-row">
                <div className="field">
                  <label className="field__label" htmlFor="rg-name">Full name</label>
                  <div className="field__wrap">
                    <span className="field__icon"><UserIcon size={18} /></span>
                    <input id="rg-name" className="field__input" type="text" autoComplete="name" placeholder="Full name"
                      value={app.fullName} onChange={set('fullName')} disabled={busy} required />
                  </div>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rg-title">Your role</label>
                  <select id="rg-title" className="field__input" value={app.jobTitle} onChange={set('jobTitle')} disabled={busy}>
                    <option value="">Choose…</option>
                    {JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="field__label" htmlFor="rg-email">Email address</label>
                  <input id="rg-email" className="field__input" type="email" inputMode="email" autoComplete="email"
                    autoCapitalize="none" placeholder="you@school.ac.ke" value={app.email} onChange={set('email')}
                    disabled={busy} required />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rg-phone">Phone <span className="field__opt">(optional)</span></label>
                  <input id="rg-phone" className="field__input" type="tel" inputMode="tel" autoComplete="tel"
                    placeholder="07XX XXX XXX" value={app.phone} onChange={set('phone')} disabled={busy} />
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label className="field__label" htmlFor="rg-password">Password</label>
                  <div className="field__wrap">
                    <span className="field__icon"><LockIcon size={18} /></span>
                    <input id="rg-password" className="field__input field__input--reveal" type={reveal ? 'text' : 'password'}
                      autoComplete="new-password" placeholder={`At least ${PASSWORD_MIN} characters`}
                      value={app.password} onChange={set('password')} disabled={busy} required />
                    {revealBtn}
                  </div>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="rg-confirm">Confirm password</label>
                  <input id="rg-confirm" className="field__input" type={reveal ? 'text' : 'password'} autoComplete="new-password"
                    placeholder="Type it again" value={app.confirm} onChange={set('confirm')} disabled={busy} required />
                </div>
              </div>
            </fieldset>

            <button className="btn" type="submit" disabled={busy || !online}>
              {busy ? 'Sending application…' : 'Send application'}
            </button>
            <p className="auth__switch">
              Already registered?{' '}
              <button type="button" className="linkbtn" onClick={() => switchView('signin')}>Sign in</button>
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
