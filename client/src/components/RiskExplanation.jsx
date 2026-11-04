import { useEffect, useState } from 'react';
import { getClassHistory } from '../db/database';
import { explainStudentRisk } from '../lib/riskExplain';
import { toISO } from '../lib/riskModel';

// The model's career rate needs every record.
const ALL_HISTORY = '0000-01-01';
/** Factors smaller than this (log-odds) are not worth showing. */
const MIN_IMPACT = 0.02;
const MAX_FACTORS = 4;

/**
 * "Why this score": the SHAP values for one student's risk, worked out on
 * the phone (lib/riskExplain.js) against their classmates. Works offline:
 * everything it reads is already on the device.
 */
export default function RiskExplanation({ student, rows }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const classRows = student.classGroupId ? await getClassHistory(student.classGroupId, ALL_HISTORY) : [];
        const byStudent = new Map();
        for (const r of classRows) {
          if (r.studentId === student.studentId) continue;
          if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
          byStudent.get(r.studentId).push({ date: r.date, status: r.status });
        }
        const explanation = explainStudentRisk(rows, [...byStudent.values()], toISO(new Date()));
        if (!cancelled) setState({ status: 'ready', explanation });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [student.studentId, student.classGroupId, rows]);

  if (state.status === 'loading') {
    return (
      <section className="risk-why" aria-busy="true">
        <h4 className="risk-note__heading">Why this score</h4>
        <p className="risk-why__note">Working it out…</p>
      </section>
    );
  }
  if (state.status === 'error') return null;

  const { explanation: e } = state;
  const shown = e.factors.filter((f) => Math.abs(f.impact) >= MIN_IMPACT).slice(0, MAX_FACTORS);
  const largest = Math.max(...shown.map((f) => Math.abs(f.impact)), MIN_IMPACT);
  const reference = e.comparedWith === 'classmates'
    ? `Compared with ${e.peers} classmate${e.peers === 1 ? '' : 's'} (average risk ${Math.round(e.baseProbability * 100)}%)`
    : 'Compared with coming to school every day';

  return (
    <section className="risk-why">
      <h4 className="risk-note__heading">Why this score</h4>
      <p className="risk-why__note">
        {reference}, these made the biggest difference to {student.fullName.split(' ')[0]}&apos;s {Math.round(e.probability * 100)}% risk:
      </p>
      {shown.length === 0 ? (
        <p className="risk-why__note">Nothing stands out: this student looks much like the comparison group.</p>
      ) : (
        <ul className="risk-why__list">
          {shown.map((f) => {
            const up = f.impact > 0;
            return (
              <li key={f.feature} className={`risk-why__row risk-why__row--${up ? 'up' : 'down'}`}>
                <div className="risk-why__top">
                  <span className="risk-why__label">{f.label}</span>
                  <span className="risk-why__value">{f.value}</span>
                </div>
                <div className="risk-why__bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(6, (Math.abs(f.impact) / largest) * 100)}%` }} />
                </div>
                <span className="risk-why__effect">{up ? 'Raises risk' : 'Lowers risk'}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="risk-why__foot">
        Worked out with SHAP, which splits the model&apos;s score into each factor&apos;s share.
      </p>
    </section>
  );
}
