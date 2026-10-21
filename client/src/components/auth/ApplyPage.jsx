import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { requestPasswordHelp } from '../../auth/session';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { COUNTIES_AZ } from '../../lib/counties';
import AuthLayout, { Field, Alert } from './AuthLayout';
import { PUBLIC_PAGES } from './publicRoute';

// Same rules as the server's application schema (schemas/schoolRegistration.schema.js).
const KENYAN_PHONE = /^(\+254|0)[17]\d{8}$/;
const SCHOOL_CODE = /^[A-Za-z0-9-]{3,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const JOB_TITLES = ['Principal', 'Deputy Principal', 'Director of Studies', 'Head of Department', 'School administrator', 'Other'];

const EMPTY = {
  schoolName: '', county: '', subCounty: '', schoolCode: '', schoolType: '', boarding: '', studentEstimate: '',
  fullName: '', jobTitle: '', email: '', phone: '',
};

/** Field-by-field problems, checked on the device with the server's rules. */
function problemsOf(a) {
  const p = {};
  if (a.schoolName.trim().length < 3) p.schoolName = 'Enter the full name of the school.';
  if (!a.county) p.county = 'Choose the county.';
  if (a.schoolCode.trim() && !SCHOOL_CODE.test(a.schoolCode.trim())) p.schoolCode = 'Letters and numbers only, like 20414001.';
  if (a.studentEstimate && !(Number(a.studentEstimate) >= 1)) p.studentEstimate = 'Enter a number, or leave it empty.';
  if (a.fullName.trim().length < 2) p.fullName = 'Enter your full name.';
  if (!EMAIL.test(a.email.trim())) p.email = 'Enter a valid email address.';
  const phone = a.phone.replace(/[\s-]/g, '');
  if (phone && !KENYAN_PHONE.test(phone)) p.phone = 'Enter a Kenyan mobile number like 0712 345 678.';
  return p;
}

/** The body for POST /api/schools/register, leaving out empty answers. */
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
    }),
  };
}

/**
 * A school applies to join. No password here: the applicant confirms their
 * email now and sets a password from the link sent once the school is approved.
 */
export default function ApplyPage() {
  const { registerSchool } = useAuth();
  const online = useOnlineStatus();
  const [app, setApp] = useState(EMPTY);
  const [problems, setProblems] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState(null);

  const set = (field) => (e) => {
    setApp((a) => ({ ...a, [field]: e.target.value }));
    if (problems[field]) setProblems((p) => ({ ...p, [field]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const found = problemsOf(app);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      setError('Some details need fixing. They are marked below.');
      return;
    }
    setBusy(true);
    try {
      const result = await registerSchool(toApplication(app));
      setSentTo(result.email);
      window.scrollTo?.(0, 0);
    } catch (err) {
      setError(err.message ?? 'Could not send the application');
      if (err.field === 'email') setProblems({ email: 'This email already has an account.' });
      setBusy(false);
    }
  }

  if (sentTo) return <CheckYourEmail email={sentTo} />;

  const input = (field, props = {}) => (
    <input id={`ap-${field}`} className="pub-input" value={app[field]} onChange={set(field)} disabled={busy} {...props} />
  );

  return (
    <AuthLayout wide>
      <form onSubmit={submit} noValidate>
        <a className="pub-back" href={PUBLIC_PAGES.signin}>← Back to sign in</a>
        <h1 className="pub-title">Apply for your school</h1>
        <p className="pub-sub">
          Fill this in as the school’s administrator (for example the principal or deputy). We check every
          school before it goes live and email you the decision, usually within two working days.
        </p>

        {!online && <Alert tone="warn">You’re offline. Connect to the internet to send your application.</Alert>}
        {error && <Alert>{error}</Alert>}

        <fieldset className="pub-section">
          <legend className="pub-section__title">School</legend>
          <Field id="ap-schoolName" label="School name" error={problems.schoolName}>
            {input('schoolName', { autoComplete: 'organization', placeholder: 'e.g. Kisumu Day Secondary School' })}
          </Field>
          <div className="pub-grid">
            <Field id="ap-county" label="County" error={problems.county}>
              <select id="ap-county" className="pub-input" value={app.county} onChange={set('county')} disabled={busy}>
                <option value="">Select county</option>
                {COUNTIES_AZ.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field id="ap-subCounty" label="Sub-county" optional>
              {input('subCounty')}
            </Field>
            <Field id="ap-schoolCode" label="School code" optional hint="Ministry of Education / KNEC code" error={problems.schoolCode}>
              {input('schoolCode', { inputMode: 'numeric' })}
            </Field>
            <Field id="ap-studentEstimate" label="Number of students" optional error={problems.studentEstimate}>
              {input('studentEstimate', { type: 'number', min: 1, inputMode: 'numeric' })}
            </Field>
            <Field id="ap-schoolType" label="Type" optional>
              <select id="ap-schoolType" className="pub-input" value={app.schoolType} onChange={set('schoolType')} disabled={busy}>
                <option value="">Select</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </Field>
            <Field id="ap-boarding" label="Day or boarding" optional>
              <select id="ap-boarding" className="pub-input" value={app.boarding} onChange={set('boarding')} disabled={busy}>
                <option value="">Select</option>
                <option value="day">Day</option>
                <option value="boarding">Boarding</option>
                <option value="mixed">Day and boarding</option>
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="pub-section">
          <legend className="pub-section__title">Your details</legend>
          <div className="pub-grid">
            <Field id="ap-fullName" label="Full name" error={problems.fullName}>
              {input('fullName', { autoComplete: 'name' })}
            </Field>
            <Field id="ap-jobTitle" label="Your role" optional>
              <select id="ap-jobTitle" className="pub-input" value={app.jobTitle} onChange={set('jobTitle')} disabled={busy}>
                <option value="">Select</option>
                {JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field id="ap-email" label="Work email" error={problems.email} hint="We send the confirmation and the decision here.">
              {input('email', { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none' })}
            </Field>
            <Field id="ap-phone" label="Phone" optional error={problems.phone}>
              {input('phone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '07XX XXX XXX' })}
            </Field>
          </div>
        </fieldset>

        <div className="pub-actions">
          <a className="pub-btn pub-btn--secondary" href={PUBLIC_PAGES.signin}>Cancel</a>
          <button className="pub-btn pub-btn--primary" type="submit" disabled={busy || !online}>
            {busy ? 'Sending…' : 'Submit application'}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}

/** After applying: what happens next, and a way to get the email again. */
function CheckYourEmail({ email }) {
  const [resent, setResent] = useState(null);
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      await requestPasswordHelp(email);
      setResent({ tone: 'info', text: `We sent the confirmation email to ${email} again.` });
    } catch (err) {
      setResent({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="pub-title">Check your email</h1>
      <p className="pub-sub">We sent a confirmation link to <b>{email}</b>.</p>
      {resent && <Alert tone={resent.tone}>{resent.text}</Alert>}
      <ol className="pub-steps">
        <li><b>Confirm your email</b> with the link. It works for 7 days.</li>
        <li><b>We review the application</b>, usually within two working days.</li>
        <li><b>You get an email with the decision.</b> If approved, it has a link to set your password and sign in.</li>
      </ol>
      <p className="pub-alt">
        No email after a few minutes? Check your spam folder, or{' '}
        <button type="button" className="pub-linkbtn" onClick={resend} disabled={busy}>send it again</button>.
      </p>
      <div className="pub-card__foot">
        <a className="pub-link" href={PUBLIC_PAGES.signin}>Back to sign in</a>
      </div>
    </AuthLayout>
  );
}
