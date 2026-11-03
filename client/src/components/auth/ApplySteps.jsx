const STEPS = [
  { title: 'Apply', text: 'Tell us about your school. It takes about two minutes.' },
  { title: 'Confirm your email', text: 'Click the link we email you. It works for 7 days.' },
  { title: 'We review it', text: 'Usually within two working days. You get an email with the decision.' },
  { title: 'Set up your school', text: 'Add your classes, students and teachers, then start taking the register.' },
];

/** "How it works" panel beside the school application. `current` is the 0-based step. */
export default function ApplySteps({ current = 0 }) {
  return (
    <aside className="apply-steps" aria-label="How joining works">
      <p className="apply-steps__eyebrow">How it works</p>
      <h2 className="apply-steps__title">Getting your school on SmartAttend</h2>
      <ol className="apply-steps__list">
        {STEPS.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          return (
            <li key={s.title} className={`apply-step apply-step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="apply-step__num" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
              <span className="apply-step__body">
                <b>{s.title}</b>
                <span>{s.text}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
