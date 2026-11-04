import { useEffect, useState } from 'react';
import { PUBLIC_PAGES } from '../auth/publicRoute';
import './landing.css';

/**
 * The public front page at the bare address (no #). Sign-in lives at #/, so
 * in-page links scroll with JavaScript instead of changing the hash.
 */

const FEATURES = [
  {
    icon: 'wifi',
    title: 'Works without internet',
    body: 'Take the register with no signal at all. Every mark is saved on the phone and sent to the school the moment a connection comes back.',
  },
  {
    icon: 'scan',
    title: 'Scan student ID cards',
    body: 'Each student gets a printed card with a QR code and barcode. The teacher’s phone camera reads it, no special hardware needed.',
  },
  {
    icon: 'pulse',
    title: 'Early warning on absence',
    body: 'A risk model watches attendance patterns and flags students likely to miss school in the next four weeks, before it becomes a habit.',
  },
  {
    icon: 'board',
    title: 'One view of the whole school',
    body: 'The school admin sees today’s registers for every class at a glance, and can correct a record with the reason kept on file.',
  },
  {
    icon: 'key',
    title: 'Invite teachers with a code',
    body: 'No shared passwords. The admin creates classes and sends each teacher a one-time code to set up their own account.',
  },
  {
    icon: 'shield',
    title: 'Each school’s data stays its own',
    body: 'Every account belongs to one school and only ever sees that school’s students and records.',
  },
];

const STEPS = [
  { title: 'Register your school', body: 'Fill in a short application. Once it is approved, you get a link to set up the admin account.' },
  { title: 'Add classes and students', body: 'Create classes, import students from a spreadsheet and print their ID cards.' },
  { title: 'Teachers take the register', body: 'A scan or a tap per student, online or offline. Reports and risk flags update on their own.' },
];

const FAQS = [
  {
    q: 'What do teachers need?',
    a: 'Any smartphone with a camera and a web browser. SmartAttend opens like a website and can be added to the home screen like an app.',
  },
  {
    q: 'What happens when there is no internet?',
    a: 'Nothing changes for the teacher. Registers are saved on the phone and sent automatically once the phone is back online, so nothing is lost.',
  },
  {
    q: 'How does the early warning work?',
    a: 'It looks at each student’s recent attendance and estimates how likely they are to miss at least 30% of school days in the next four weeks. Students above the line are flagged for follow-up.',
  },
  {
    q: 'Who can see our school’s records?',
    a: 'Only staff accounts created for your school. The school admin decides who joins, and every correction to a record is logged with a reason.',
  },
];

const REGISTER = [
  { name: 'Amina Wanjiru', adm: '3B/001', status: 'present' },
  { name: 'Brian Kamau', adm: '3B/002', status: 'present' },
  { name: 'Daniel Mutua', adm: '3B/003', status: 'absent' },
  { name: 'Faith Achieng', adm: '3B/004', status: 'present' },
  { name: 'Grace Muthoni', adm: '3B/005', status: 'late' },
];

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const prev = document.title;
    document.title = 'SmartAttend: school attendance that works offline';
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="lp">
      <header className={`lp-nav${scrolled ? ' lp-nav--scrolled' : ''}`}>
        <div className="lp-wrap lp-nav__inner">
          <a className="lp-brand" href="/" aria-label="SmartAttend home">
            <Logo />
            <span>SmartAttend</span>
          </a>
          <nav className="lp-nav__links" aria-label="Page sections">
            <NavLink to="features">Features</NavLink>
            <NavLink to="how">How it works</NavLink>
            <NavLink to="insights">Early warning</NavLink>
            <NavLink to="faq">FAQ</NavLink>
          </nav>
          <div className="lp-nav__actions">
            <a className="lp-btn lp-btn--ghost" href={PUBLIC_PAGES.signin}>Sign in</a>
            <a className="lp-btn lp-btn--primary lp-hide-sm" href={PUBLIC_PAGES.apply}>Register your school</a>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="lp-hero">
          <div className="lp-hero__glow" aria-hidden="true" />
          <div className="lp-wrap lp-hero__grid">
            <div className="lp-hero__copy">
              <span className="lp-pill"><span className="lp-pill__dot" />Built for Kenyan secondary schools</span>
              <h1 className="lp-h1">
                Every student counted.<br />
                <span className="lp-h1__accent">Even offline.</span>
              </h1>
              <p className="lp-lead">
                SmartAttend turns the daily register into a two-minute job on any phone, keeps working when the
                network doesn’t, and warns you early about the students who are starting to slip away.
              </p>
              <div className="lp-hero__cta">
                <a className="lp-btn lp-btn--primary lp-btn--lg" href={PUBLIC_PAGES.apply}>
                  Register your school <Arrow />
                </a>
                <button type="button" className="lp-btn lp-btn--soft lp-btn--lg" onClick={() => scrollToId('how')}>
                  See how it works
                </button>
              </div>
              <ul className="lp-checks">
                <li><Check /> Works with no signal</li>
                <li><Check /> No special hardware</li>
                <li><Check /> Set up in a day</li>
              </ul>
            </div>

            <div className="lp-hero__visual" aria-hidden="true">
              <div className="lp-mock">
                <div className="lp-mock__head">
                  <div>
                    <div className="lp-mock__eyebrow">Take attendance</div>
                    <div className="lp-mock__title">Form 3 B</div>
                  </div>
                  <span className="lp-tag lp-tag--offline"><span className="lp-tag__dot" />Offline</span>
                </div>
                <div className="lp-mock__progress">
                  <div className="lp-mock__bar"><span style={{ width: '80%' }} /></div>
                  <span>32 of 40 marked</span>
                </div>
                <ul className="lp-mock__list">
                  {REGISTER.map((s) => (
                    <li key={s.adm}>
                      <span className="lp-avatar">{s.name.split(' ').map((p) => p[0]).join('')}</span>
                      <span className="lp-mock__name">{s.name}<small>{s.adm}</small></span>
                      <span className={`lp-status lp-status--${s.status}`}>{s.status}</span>
                    </li>
                  ))}
                </ul>
                <div className="lp-mock__foot">
                  <Icon name="cloud" /> 18 records saved on this phone, will send when online
                </div>
              </div>

              <div className="lp-float lp-float--risk">
                <div className="lp-float__icon lp-float__icon--amber"><Icon name="pulse" /></div>
                <div>
                  <strong>3 students at risk</strong>
                  <span>Flagged for follow-up this week</span>
                </div>
              </div>

              <div className="lp-float lp-float--scan">
                <div className="lp-float__icon lp-float__icon--green"><Icon name="scan" /></div>
                <div>
                  <strong>Card scanned</strong>
                  <span>Brian Kamau · present</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Key facts */}
        <section className="lp-facts">
          <div className="lp-wrap lp-facts__grid">
            <Fact value="0 bars" label="of signal needed to take the register" />
            <Fact value="1 scan" label="per student with the phone camera" />
            <Fact value="4 weeks" label="of warning before chronic absence sets in" />
            <Fact value="1 school" label="per account, so your data stays yours" />
          </div>
        </section>

        {/* Features */}
        <section className="lp-section" id="features">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Features"
              title="Everything a school needs to know who is in class"
              sub="Simple enough for a teacher in a hurry, detailed enough for the head teacher’s report."
            />
            <div className="lp-features">
              {FEATURES.map((f) => (
                <article key={f.title} className="lp-card">
                  <div className="lp-card__icon"><Icon name={f.icon} /></div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="lp-section lp-section--tint" id="how">
          <div className="lp-wrap">
            <SectionHead eyebrow="How it works" title="Up and running in three steps" />
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="lp-step">
                  <span className="lp-step__num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Early warning */}
        <section className="lp-section" id="insights">
          <div className="lp-wrap lp-split">
            <div>
              <SectionHead
                align="left"
                eyebrow="Early warning"
                title="Spot the students who are drifting, before they are gone"
                sub="Chronic absence rarely starts all at once. SmartAttend reads each student’s pattern and tells you who needs a conversation now."
              />
              <ul className="lp-bullets">
                <li><Check /> Risk flags in plain colours: red, amber, clear</li>
                <li><Check /> Absence reasons recorded, such as fees or health</li>
                <li><Check /> Follow-ups tracked for each flagged student</li>
              </ul>
            </div>
            <div className="lp-chart" aria-hidden="true">
              <div className="lp-chart__head">
                <strong>Attendance this term</strong>
                <span className="lp-tag lp-tag--soft">Form 3 B</span>
              </div>
              <div className="lp-chart__bars">
                {[92, 95, 90, 88, 93, 86, 81, 89, 94, 91, 84, 96].map((v, i) => (
                  <span key={i} style={{ height: `${(v - 60) * 2.4}%` }} className={v < 85 ? 'is-low' : ''} />
                ))}
              </div>
              <div className="lp-chart__rows">
                <RiskRow name="Daniel Mutua" note="Absent 4 of the last 9 days" level="red" />
                <RiskRow name="Grace Muthoni" note="Late often, missed 2 Mondays" level="amber" />
                <RiskRow name="Kevin Odhiambo" note="Back to normal this week" level="clear" />
              </div>
            </div>
          </div>
        </section>

        {/* Roles */}
        <section className="lp-section lp-section--tint">
          <div className="lp-wrap">
            <SectionHead eyebrow="For everyone at school" title="One app, the right view for each role" />
            <div className="lp-roles">
              <div className="lp-role lp-role--indigo">
                <h3>School admins</h3>
                <ul>
                  <li>See every class’s register for today</li>
                  <li>Create classes and assign teachers</li>
                  <li>Add students and print ID cards</li>
                  <li>Correct records, with the reason logged</li>
                </ul>
              </div>
              <div className="lp-role lp-role--mint">
                <h3>Teachers</h3>
                <ul>
                  <li>Take the register in a couple of minutes</li>
                  <li>Scan cards or tap present and absent</li>
                  <li>Work offline, sync later without thinking</li>
                  <li>Check reports and at-risk students</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="lp-section" id="faq">
          <div className="lp-wrap lp-wrap--narrow">
            <SectionHead eyebrow="FAQ" title="Questions schools ask us" />
            <div className="lp-faq">
              {FAQS.map((f, i) => {
                const open = openFaq === i;
                return (
                  <div key={f.q} className={`lp-faq__item${open ? ' is-open' : ''}`}>
                    <button type="button" className="lp-faq__q" aria-expanded={open} onClick={() => setOpenFaq(open ? -1 : i)}>
                      {f.q}
                      <span className="lp-faq__sign" aria-hidden="true" />
                    </button>
                    <div className="lp-faq__a" hidden={!open}><p>{f.a}</p></div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section className="lp-cta">
          <div className="lp-wrap">
            <div className="lp-cta__box">
              <h2>Ready to know who’s in class, every day?</h2>
              <p>Register your school today. We review every application and send you a link to get started.</p>
              <div className="lp-hero__cta lp-hero__cta--center">
                <a className="lp-btn lp-btn--white lp-btn--lg" href={PUBLIC_PAGES.apply}>Register your school <Arrow /></a>
                <a className="lp-btn lp-btn--outline-white lp-btn--lg" href={PUBLIC_PAGES.join}>I have an invite code</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer__inner">
          <a className="lp-brand" href="/"><Logo /><span>SmartAttend</span></a>
          <p>School attendance for Kenyan secondary schools.</p>
          <nav className="lp-footer__links" aria-label="Account">
            <a href={PUBLIC_PAGES.signin}>Sign in</a>
            <a href={PUBLIC_PAGES.apply}>Register your school</a>
            <a href={PUBLIC_PAGES.join}>Join with a code</a>
          </nav>
        </div>
        <div className="lp-wrap lp-footer__base">© {new Date().getFullYear()} SmartAttend</div>
      </footer>
    </div>
  );
}

function NavLink({ to, children }) {
  return <button type="button" className="lp-nav__link" onClick={() => scrollToId(to)}>{children}</button>;
}

function SectionHead({ eyebrow, title, sub, align = 'center' }) {
  return (
    <div className={`lp-head lp-head--${align}`}>
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2 className="lp-h2">{title}</h2>
      {sub && <p className="lp-sub">{sub}</p>}
    </div>
  );
}

function Fact({ value, label }) {
  return (
    <div className="lp-fact">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RiskRow({ name, note, level }) {
  return (
    <div className="lp-risk">
      <span className={`lp-risk__dot lp-risk__dot--${level}`} />
      <span className="lp-risk__name">{name}<small>{note}</small></span>
      <span className={`lp-risk__tag lp-risk__tag--${level}`}>{level}</span>
    </div>
  );
}

function Logo() {
  return (
    <svg className="lp-logo" viewBox="0 0 48 48" width="28" height="28" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#4f46e5" />
      <path d="M13 25l7.5 7.5L35 16" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg className="lp-check" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="currentColor" opacity=".14" />
      <path d="M6 10.4l2.6 2.6L14 7.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M4 10h11m-4-4.5L15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PATHS = {
  wifi: 'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10',
  pulse: 'M3 12h4l2.5-6 5 12 2.5-6H21',
  board: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zM13.2 12.7 20 19.5M17 16.5l2-2',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9zM12 11v5m-2-2 2 2 2-2',
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
