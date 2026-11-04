import { useMemo, useState } from 'react';
import { todayISO } from '../db/database';
import { riskHeadline, riskInsights, isSchoolDay, toISO } from '../lib/riskModel';
import { formatLongDate } from '../lib/attendanceSummary';
import { useClassRisk } from '../hooks/useClassRisk';
import Avatar from './Avatar';
import RiskDialog from './RiskDialog';
import MonthCalendar from './MonthCalendar';
import Modal from './Modal';
import { ArrowRightIcon, CheckCircleIcon, AlertTriangleIcon, InfoIcon } from './icons';

const ATTENDED = new Set(['present']);
const CHART_DAYS = 10;
const AVERAGE_DAYS = 63; // the "9-week average"

function lastSchoolDays(n, endISO) {
  const out = [];
  const [y, m, d] = endISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  while (out.length < n) {
    const iso = toISO(dt);
    if (isSchoolDay(iso)) out.unshift(iso);
    dt.setDate(dt.getDate() - 1);
  }
  return out;
}

function shortDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

/** Daily attendance rate as vertical bars. Days with no register taken are left empty. */
function RateChart({ days, onOpenDay }) {
  const [hover, setHover] = useState(null);
  const h = 160;
  return (
    <div className="ratechart">
      <div className="ratechart__plot" style={{ height: h }}>
        {[100, 75, 50, 25].map((g) => (
          <div key={g} className="ratechart__grid" style={{ bottom: `${g}%` }}>
            <span>{g}%</span>
          </div>
        ))}
        <div className="ratechart__bars">
          {days.map((d, i) => (
            <button
              type="button"
              key={d.date}
              className="ratechart__col"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onOpenDay?.(d.date)}
              aria-label={`${shortDay(d.date)}: ${d.rate == null ? 'no register' : `${Math.round(d.rate * 100)}% attended`}. Open this day's register`}
            >
              {d.rate != null && (
                <div
                  className={`ratechart__bar${d.rate < 0.85 ? ' ratechart__bar--low' : ''}`}
                  style={{ height: `${Math.max(d.rate * 100, 2)}%` }}
                />
              )}
              {hover === i && (
                <div className="ratechart__tip" role="tooltip">
                  <b>{shortDay(d.date)}</b>
                  {d.rate == null ? 'No register taken' : (
                    <>
                      <span>{Math.round(d.rate * 100)}% attended</span>
                      <span>{d.present} present · {d.absent} absent</span>
                    </>
                  )}
                  <span className="ratechart__tip-hint">Click to open this day</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="ratechart__axis">
        {days.map((d) => <span key={d.date}>{shortDay(d.date)}</span>)}
      </div>
    </div>
  );
}

export default function Dashboard({
  classGroupId, className, onTakeAttendance, onOpenAlerts, onOpenProfile, onOpenScanStation, onOpenRegisterDay, onOpenRegisterFiltered,
}) {
  const { loading, students, history, flagged } = useClassRisk(classGroupId);
  const [riskFor, setRiskFor] = useState(null);
  const [pickedDay, setPickedDay] = useState(null);
  const today = todayISO();

  const { todayStats, chartDays, termRate, dayStat, firstDate } = useMemo(() => {
    const byDate = new Map();
    for (const r of history) {
      if (!byDate.has(r.date)) byDate.set(r.date, { present: 0, absent: 0 });
      if (r.status in byDate.get(r.date)) byDate.get(r.date)[r.status] += 1;
    }
    const stat = (date) => {
      const s = byDate.get(date);
      if (!s) return { date, rate: null, present: 0, absent: 0, marked: 0 };
      const marked = s.present + s.absent;
      return { date, ...s, marked, rate: marked ? s.present / marked : null };
    };
    // history now holds every record (for the model), so cut it to nine weeks here.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - AVERAGE_DAYS);
    const recent = history.filter((r) => r.date >= toISO(cutoff));
    const attended = recent.filter((r) => ATTENDED.has(r.status)).length;
    return {
      todayStats: stat(today),
      chartDays: lastSchoolDays(CHART_DAYS, today).map(stat),
      termRate: recent.length ? attended / recent.length : null,
      dayStat: stat,
      firstDate: history.length ? history.reduce((a, r) => (r.date < a ? r.date : a), history[0].date) : today,
    };
  }, [history, today]);

  if (loading) return <p className="empty">Loading dashboard…</p>;

  const unmarked = students.length - todayStats.marked;
  const red = flagged.filter((f) => f.risk.flag === 'red').length;
  const absentToday = history
    .filter((r) => r.date === today && r.status === 'absent')
    .map((r) => students.find((s) => s.studentId === r.studentId))
    .filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-head__title">Dashboard</h2>
          <p className="page-head__sub">{className} · {formatLongDate(today)}</p>
        </div>
        <div className="page-head__actions">
          {onOpenScanStation && (
            <button type="button" className="btn btn--outline btn--sm" onClick={onOpenScanStation}>
              Gate scan station
            </button>
          )}
          <button type="button" className="btn btn--sm" onClick={onTakeAttendance}>
            <CheckCircleIcon size={16} />
            Take attendance
          </button>
        </div>
      </div>

      {isSchoolDay(today) && unmarked > 0 && (
        <div className="callout">
          <AlertTriangleIcon size={18} />
          <span>
            {todayStats.marked === 0
              ? "Today's register has not been taken yet."
              : `${unmarked} student${unmarked === 1 ? '' : 's'} still not marked today.`}
          </span>
          <button type="button" className="linkbtn" onClick={onTakeAttendance}>Open register</button>
        </div>
      )}

      <div className="kpis">
        <button type="button" className="kpi kpi--button kpi--link" onClick={onTakeAttendance}>
          <span className="kpi__label">Attendance today</span>
          <span className="kpi__value">{todayStats.rate == null ? '-' : `${Math.round(todayStats.rate * 100)}%`}</span>
          <span className="kpi__sub">{todayStats.marked} of {students.length} marked</span>
          <span className="kpi__go">Open register <ArrowRightIcon size={12} /></span>
        </button>
        <button type="button" className="kpi kpi--button kpi--link" onClick={() => onOpenRegisterFiltered?.('present')}>
          <span className="kpi__label"><span className="dot dot--present" />Present</span>
          <span className="kpi__value">{todayStats.present}</span>
          <span className="kpi__sub">today</span>
          <span className="kpi__go">See who <ArrowRightIcon size={12} /></span>
        </button>
        <button type="button" className="kpi kpi--button kpi--link" onClick={() => onOpenRegisterFiltered?.('absent')}>
          <span className="kpi__label"><span className="dot dot--absent" />Absent</span>
          <span className="kpi__value">{todayStats.absent}</span>
          <span className="kpi__sub">today</span>
          <span className="kpi__go">See who <ArrowRightIcon size={12} /></span>
        </button>
        <button type="button" className="kpi kpi--button kpi--link" onClick={onOpenAlerts}>
          <span className="kpi__label">At-risk students</span>
          <span className="kpi__value">{flagged.length}</span>
          <span className="kpi__sub">{red} high risk</span>
          <span className="kpi__go">View list <ArrowRightIcon size={12} /></span>
        </button>
      </div>

      <div className="dash-grid">
        <section className="panel panel--pad">
          <div className="panel__head">
            <div>
              <h3 className="panel__title">Daily attendance rate</h3>
              <p className="panel__sub">
                Last {CHART_DAYS} school days · click a day to open its register
                {termRate != null && ` · 9-week average ${Math.round(termRate * 100)}%`}
              </p>
            </div>
          </div>
          <RateChart days={chartDays} onOpenDay={onOpenRegisterDay} />
        </section>

        <section className="panel panel--pad">
          <div className="panel__head">
            <div>
              <h3 className="panel__title">Absent today</h3>
              <p className="panel__sub">{absentToday.length} student{absentToday.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          {absentToday.length === 0 ? (
            <p className="empty empty--sm">
              {todayStats.marked === 0 ? 'No register taken yet today.' : 'Nobody is absent today.'}
            </p>
          ) : (
            <ul className="mini-list">
              {absentToday.map((s) => (
                <li key={s.studentId}>
                  <button type="button" className="student-cell" onClick={() => onOpenProfile?.(s.studentId)}>
                    <Avatar name={s.fullName} size="sm" />
                    <span className="student-cell__text">
                      <span className="student-cell__name">{s.fullName}</span>
                      <span className="student-cell__sub">{s.admissionNo || '-'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel panel--pad">
        <MonthCalendar
          title="Class calendar"
          subtitle="How many students came each day. Click a day for details."
          firstMonth={firstDate}
          onPick={setPickedDay}
          legend={[
            { tone: 'good', label: '9 in 10 or more came' },
            { tone: 'fair', label: '8 in 10' },
            { tone: 'low', label: 'Fewer than 8 in 10' },
            { tone: 'none', label: 'Register not taken' },
          ]}
          getDay={(iso) => {
            const s = dayStat(iso);
            if (!s.marked) return { tone: 'none', text: 'Not taken' };
            const came = s.present;
            const tone = s.rate >= 0.9 ? 'good' : s.rate >= 0.8 ? 'fair' : 'low';
            return { tone, text: `${came} of ${s.marked}`, sub: s.absent ? `${s.absent} absent` : 'All present' };
          }}
        />
      </section>

      <section className="panel">
        <div className="panel__head panel__head--pad">
          <div>
            <h3 className="panel__title">Students needing attention</h3>
            <p className="panel__sub">Highest predicted absenteeism risk</p>
          </div>
          <button type="button" className="linkbtn" onClick={onOpenAlerts}>
            View all <ArrowRightIcon size={13} />
          </button>
        </div>
        {flagged.length === 0 ? (
          <p className="empty empty--sm">No students are flagged right now.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Risk level</th>
                  <th>Risk score</th>
                  <th className="col-hide-sm">Attendance (last 2 wks)</th>
                </tr>
              </thead>
              <tbody>
                {flagged.slice(0, 5).map(({ student, risk, features }) => {
                  const headline = riskHeadline(risk);
                  return (
                    <tr key={student.studentId} className="row--link" onClick={() => onOpenProfile?.(student.studentId)}>
                      <td>
                        <div className="student-cell student-cell--static">
                          <Avatar name={student.fullName} size="sm" />
                          <span className="student-cell__text">
                            <span className="student-cell__name">{student.fullName}</span>
                            <span className="student-cell__sub">{student.admissionNo || '-'}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="risk-level">
                          <span className={`dot dot--${risk.flag === 'red' ? 'absent' : 'warn'}`} />
                          {risk.flag === 'red' ? 'High' : 'Medium'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="risk-toggle"
                          aria-haspopup="dialog"
                          title="Explain this score"
                          onClick={(e) => { e.stopPropagation(); setRiskFor(student.studentId); }}
                        >
                          <b>{headline.pct}%</b>
                          <InfoIcon size={14} className="risk-toggle__chev" />
                        </button>
                      </td>
                      <td className="col-hide-sm">
                        {features.attendance_rate_w1 == null ? '-' : `${Math.round(features.attendance_rate_w1 * 100)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {pickedDay && (() => {
        const s = dayStat(pickedDay);
        const who = (status) => history
          .filter((r) => r.date === pickedDay && r.status === status)
          .map((r) => students.find((st) => st.studentId === r.studentId))
          .filter(Boolean);
        const absent = who('absent');
        const tone = !s.marked ? null : s.rate >= 0.9 ? 'green' : s.rate >= 0.8 ? 'amber' : 'red';
        return (
          <Modal
            eyebrow="Class attendance"
            title={formatLongDate(pickedDay)}
            labelId="dash-day-title"
            badge={<span className={`modal__level${tone ? ` modal__level--${tone}` : ''}`}>{s.marked ? `${s.present} of ${s.marked} came` : 'Not taken'}</span>}
            onClose={() => setPickedDay(null)}
            actions={(
              <button type="button" className="btn btn--sm" onClick={() => { setPickedDay(null); onOpenRegisterDay?.(pickedDay); }}>
                {s.marked ? 'Open this day’s register' : 'Take the register for this day'}
              </button>
            )}
          >
            {!s.marked ? (
              <p className="risk-note__summary">The register was not taken on this day.</p>
            ) : (
              <div className="risk-note">
                <dl className="risk-note__facts">
                  <div><dt>At school</dt><dd>{s.present}</dd></div>
                  <div><dt>Absent</dt><dd>{s.absent}</dd></div>
                  <div><dt>Attendance</dt><dd>{Math.round(s.rate * 100)}%</dd></div>
                </dl>
                <section>
                  <h4 className="risk-note__heading">{absent.length ? 'Who was absent' : 'Everyone was at school'}</h4>
                  {absent.length > 0 && (
                    <ul className="mini-list">
                      {absent.map((st) => (
                        <li key={st.studentId}>
                          <button type="button" className="student-cell" onClick={() => { setPickedDay(null); onOpenProfile?.(st.studentId); }}>
                            <Avatar name={st.fullName} size="sm" />
                            <span className="student-cell__text">
                              <span className="student-cell__name">{st.fullName}</span>
                              <span className="student-cell__sub">{st.admissionNo || '-'}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </Modal>
        );
      })()}
      {(() => {
        const sel = riskFor && flagged.find((x) => x.student.studentId === riskFor);
        if (!sel) return null;
        return (
          <RiskDialog
            student={sel.student}
            rows={sel.rows}
            features={sel.features}
            risk={sel.risk}
            reasons={riskInsights(sel.rows, sel.features, sel.risk)}
            onClose={() => setRiskFor(null)}
            onOpenProfile={() => { setRiskFor(null); onOpenProfile?.(sel.student.studentId); }}
          />
        );
      })()}
    </>
  );
}
