import { useMemo } from 'react';
import { attendanceCounts, toISO } from '../lib/riskModel';

const SUMMARY = {
  red: (n) => `${n} has been missing a lot of school and needs a check-in soon.`,
  amber: (n) => `${n}'s attendance has slipped. A quick check-in is a good idea.`,
  green: (n) => `${n}'s attendance looks normal. Nothing to do for now.`,
};

const days = (w) => (w && w.days ? `${w.attended} of ${w.days} days` : '-');

/**
 * A short, plain note for the teacher: how the student is doing, what was
 * noticed, a few attendance facts and what to do next. No model details.
 */
export default function RiskBreakdown({ name = 'This student', rows, features, risk, reasons, asOf = toISO(new Date()) }) {
  const c = useMemo(() => attendanceCounts(rows, asOf), [rows, asOf]);
  const first = name.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').split(' ')[0] || name;
  const streak = features.longest_absence_streak ?? 0;
  const noticed = (reasons ?? []).slice(0, 3);

  const facts = [
    { label: 'Last 2 weeks', value: days(c.w1) },
    { label: 'A month ago', value: days(c.w3) },
    { label: 'Longest absence', value: streak ? `${streak} day${streak === 1 ? '' : 's'} in a row` : 'None' },
  ];

  return (
    <div className="risk-note">
      <p className={`risk-note__summary risk-note__summary--${risk.flag}`}>{SUMMARY[risk.flag](first)}</p>

      {noticed.length > 0 && risk.flag !== 'green' && (
        <section>
          <h4 className="risk-note__heading">What we noticed</h4>
          <ul className="risk-note__list">
            {noticed.map((text, i) => <li key={i}>{text}</li>)}
          </ul>
        </section>
      )}

      <section>
        <h4 className="risk-note__heading">Came to school</h4>
        <dl className="risk-note__facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {risk.flag !== 'green' && (
        <section>
          <h4 className="risk-note__heading">What you can do</h4>
          <ul className="risk-note__list risk-note__list--steps">
            <li>Call the parent or guardian to find out why {first} has been away.</li>
            <li>Talk to {first} when they are back in school.</li>
            <li>Log the follow-up on {first}&apos;s profile so the school knows it was done.</li>
          </ul>
        </section>
      )}
    </div>
  );
}
