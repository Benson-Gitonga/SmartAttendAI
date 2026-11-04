import { useEffect, useRef, useState } from 'react';
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

const REGISTERS = [
  {
    id: 'form3b',
    title: 'Form 3 B',
    marked: 32, total: 40, offline: true,
    foot: '18 records saved on this phone, will send when online',
    students: [
      { name: 'Amina Wanjiru', adm: '3B/001', status: 'present' },
      { name: 'Brian Kamau', adm: '3B/002', status: 'present' },
      { name: 'Daniel Mutua', adm: '3B/003', status: 'absent' },
      { name: 'Faith Achieng', adm: '3B/004', status: 'present' },
      { name: 'Grace Muthoni', adm: '3B/005', status: 'absent' },
    ],
  },
  {
    id: 'form2a',
    title: 'Form 2 A',
    marked: 38, total: 38, offline: false,
    foot: 'Register sent to the school office at 7:52 am',
    students: [
      { name: 'Joseph Njoroge', adm: '2A/011', status: 'present' },
      { name: 'Mercy Atieno', adm: '2A/012', status: 'present' },
      { name: 'Peter Kiprono', adm: '2A/013', status: 'present' },
      { name: 'Ruth Nyambura', adm: '2A/014', status: 'absent' },
      { name: 'Samuel Ochieng', adm: '2A/015', status: 'present' },
    ],
  },
];

// While a menu link scrolls the page, keep the nav on screen.
let navPinnedUntil = 0;

function scrollToId(id) {
  navPinnedUntil = Date.now() + 1500;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const SECTIONS = [
  { id: 'features', label: 'Features' },
  { id: 'how', label: 'How it works' },
  { id: 'insights', label: 'Early warning' },
  { id: 'faq', label: 'FAQ' },
];

/** Scroll position for the floating nav: past the top, hidden while scrolling down, progress 0..1. */
function useScrollState() {
  const [state, setState] = useState({ scrolled: false, hidden: false, progress: 0 });
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const goingDown = y > lastY + 4;
      const goingUp = y < lastY - 4;
      setState((s) => ({
        scrolled: y > 24,
        // Tuck the nav away while reading down the page; bring it back on any scroll up.
        hidden: Date.now() > navPinnedUntil && y > 480 && (goingDown || (s.hidden && !goingUp)),
        progress: max > 0 ? Math.min(1, y / max) : 0,
      }));
      if (goingDown || goingUp) lastY = y;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return state;
}

/** The section currently on screen, to highlight its nav link. */
function useActiveSection(ids) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: [0, 0.25, 0.5] },
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

/** Fade elements marked .lp-reveal in as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll('.lp-reveal')];
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('is-in'));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          observer.unobserve(e.target);
        }
      }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

const SECTION_IDS = SECTIONS.map((s) => s.id);

/** Stagger children: style={delay(i)} on the i-th item. */
const delay = (i, step = 80) => ({ '--lp-delay': `${i * step}ms` });

export default function LandingPage() {
  const { scrolled, hidden, progress } = useScrollState();
  const active = useActiveSection(SECTION_IDS);
  const [openFaq, setOpenFaq] = useState(0);
  useReveal();

  useEffect(() => {
    const prev = document.title;
    document.title = 'SmartAttend: school attendance that works offline';
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="lp">
      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}${hidden ? ' is-hidden' : ''}`}>
        <div className="lp-nav__inner">
          <a
            className="lp-brand lp-brand--word"
            href="/"
            aria-label="SmartAttend, back to top"
            onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          >
            Smart<span>Attend</span>
          </a>
          <nav className="lp-nav__links" aria-label="Page sections">
            {SECTIONS.map((s) => (
              <NavLink key={s.id} to={s.id} active={active === s.id}>{s.label}</NavLink>
            ))}
          </nav>
          <div className="lp-nav__actions">
            <a className="lp-btn lp-btn--ghost" href={PUBLIC_PAGES.signin}>Sign in</a>
            <a className="lp-btn lp-btn--primary lp-hide-sm" href={PUBLIC_PAGES.apply}>Register your school</a>
          </div>
          <span className="lp-nav__progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="lp-hero">
          <div className="lp-hero__glow" aria-hidden="true" />
          <div className="lp-wrap lp-hero__grid">
            <div className="lp-hero__copy lp-enter">
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

            <div className="lp-hero__visual lp-enter lp-enter--late" aria-hidden="true">
              <RegisterStack />

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
          <div className="lp-wrap"><div className="lp-facts__grid">
            <Fact i={0} value="0 bars" label="of signal needed to take the register" />
            <Fact i={1} value="1 scan" label="per student with the phone camera" />
            <Fact i={2} value="4 weeks" label="of warning before chronic absence sets in" />
            <Fact i={3} value="1 school" label="per account, so your data stays yours" />
          </div>
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
              {FEATURES.map((f, i) => (
                <article key={f.title} className="lp-card lp-reveal" style={delay(i % 3)}>
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
                <li key={s.title} className="lp-step lp-reveal" style={delay(i, 120)}>
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
            <div className="lp-reveal">
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
            <div className="lp-chart lp-reveal lp-reveal--right" style={delay(1, 120)} aria-hidden="true">
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
                <RiskRow name="Grace Muthoni" note="Missed the last 2 Mondays" level="amber" />
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
              <div className="lp-role lp-role--indigo lp-reveal">
                <h3>School admins</h3>
                <ul>
                  <li>See every class’s register for today</li>
                  <li>Create classes and assign teachers</li>
                  <li>Add students and print ID cards</li>
                  <li>Correct records, with the reason logged</li>
                </ul>
              </div>
              <div className="lp-role lp-role--mint lp-reveal" style={delay(1, 120)}>
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
                  // Open state lives in data-open, not className: React rewriting
                  // className would drop the is-in class useReveal adds and hide the item.
                  <div key={f.q} className="lp-faq__item lp-reveal" data-open={open || undefined} style={delay(i, 70)}>
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
            <div className="lp-cta__box lp-reveal lp-reveal--zoom">
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
          <a className="lp-brand lp-brand--word" href="/">Smart<span>Attend</span></a>
          <p>School attendance that works offline.</p>
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

function NavLink({ to, active, children }) {
  return (
    <button
      type="button"
      className={`lp-nav__link${active ? ' is-active' : ''}`}
      aria-current={active ? 'true' : undefined}
      onClick={() => scrollToId(to)}
    >
      {children}
    </button>
  );
}

/**
 * Two register cards stacked like a fanned deck. Hovering fans them apart;
 * hovering or tapping the card behind brings it to the front.
 */
function RegisterStack() {
  const [front, setFront] = useState(REGISTERS[0].id);
  // A card that comes forward slides out from under the pointer, leaving it
  // over the other card; ignore hovers until the swap has settled.
  const settledAt = useRef(0);
  const bringForward = (id, at, { fromHover = false } = {}) => {
    if (id === front) return;
    if (fromHover && at < settledAt.current) return;
    settledAt.current = at + 750;
    setFront(id);
  };
  return (
    <div className="lp-stack">
      {REGISTERS.map((r) => {
        const isFront = r.id === front;
        return (
          <div
            key={r.id}
            className={`lp-mock lp-stack__card ${isFront ? 'is-front' : 'is-back'}`}
            onMouseEnter={(e) => { if (window.matchMedia?.('(hover: hover)').matches) bringForward(r.id, e.timeStamp, { fromHover: true }); }}
            onClick={(e) => bringForward(r.id, e.timeStamp)}
          >
            <RegisterCard register={r} />
          </div>
        );
      })}
    </div>
  );
}

function RegisterCard({ register: r }) {
  const done = r.marked === r.total;
  return (
    <>
      <div className="lp-mock__head">
        <div>
          <div className="lp-mock__eyebrow">{done ? 'Register complete' : 'Take attendance'}</div>
          <div className="lp-mock__title">{r.title}</div>
        </div>
        {r.offline
          ? <span className="lp-tag lp-tag--offline"><span className="lp-tag__dot" />Offline</span>
          : <span className="lp-tag lp-tag--synced"><span className="lp-tag__dot" />Synced</span>}
      </div>
      <div className="lp-mock__progress">
        <div className="lp-mock__bar"><span style={{ width: `${Math.round((r.marked / r.total) * 100)}%` }} /></div>
        <span>{r.marked} of {r.total} marked</span>
      </div>
      <ul className="lp-mock__list">
        {r.students.map((s) => (
          <li key={s.adm}>
            <span className="lp-avatar">{s.name.split(' ').map((p) => p[0]).join('')}</span>
            <span className="lp-mock__name">{s.name}<small>{s.adm}</small></span>
            <span className={`lp-status lp-status--${s.status}`}>{s.status}</span>
          </li>
        ))}
      </ul>
      <div className="lp-mock__foot">
        <Icon name="cloud" /> {r.foot}
      </div>
    </>
  );
}

function SectionHead({ eyebrow, title, sub, align = 'center' }) {
  return (
    <div className={`lp-head lp-head--${align}${align === 'center' ? ' lp-reveal' : ''}`}>
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2 className="lp-h2">{title}</h2>
      {sub && <p className="lp-sub">{sub}</p>}
    </div>
  );
}

function Fact({ i, value, label }) {
  return (
    <div className="lp-fact lp-reveal" style={delay(i)}>
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
