import { useEffect, useMemo, useState } from 'react';
import { getStudentById, getStudentHistory, getFollowUpSummary } from '../db/database';
import {
  computeFeatures,
  scoreRiskML,
  riskInsights,
  isAssessable,
  toISO,
} from '../lib/riskModel';
import Avatar from './Avatar';
import FollowUpCard from './FollowUpCard';
import Modal from './Modal';
import RiskDialog from './RiskDialog';
import MonthCalendar from './MonthCalendar';
import { InfoIcon } from './icons';

const RISK_LABEL = { red: 'High risk', amber: 'Medium risk', green: 'On track' };
const RISK_TAKEAWAY = {
  red: 'Likely to keep missing school without a check-in.',
  amber: 'Attendance has slipped. Worth a check-in soon.',
};

function trendLabel(trend) {
  if (trend == null) return null;
  if (trend <= -0.1) return 'Getting worse';
  if (trend >= 0.1) return 'Improving';
  return 'Steady';
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    long: dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    weekday: dt.toLocaleDateString('en-GB', { weekday: 'long' }),
  };
}

const CAL_TEXT = { present: 'Present', absent: 'Absent' };
const REASON_TEXT = { fee: 'School fees', health: 'Illness or health', other: 'Other reason', unknown: 'Reason not known' };
const METHOD_TEXT = {
  manual: 'Marked by the teacher in the register',
  rfid: 'ID card scanned at the gate',
  fingerprint: 'Fingerprint at the gate',
  import: 'Imported from earlier records',
};

function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Pop-up with the details of one calendar day. */
function DayDialog({ iso, record, onOpenDay, onClose }) {
  const { long, weekday } = fmtDate(iso);
  const saved = fmtTime(record?.updatedAt ?? record?.createdAt);
  const tone = record ? (record.status === 'absent' ? 'red' : 'green') : null;
  return (
    <Modal
      eyebrow="Attendance"
      title={`${weekday}, ${long}`}
      labelId="day-dialog-title"
      badge={
        <span className={`modal__level${tone ? ` modal__level--${tone}` : ''}`}>
          {record ? CAL_TEXT[record.status] : 'Not taken'}
        </span>
      }
      onClose={onClose}
      actions={onOpenDay && (
        <button type="button" className="btn btn--sm" onClick={() => { onClose(); onOpenDay(iso); }}>
          {record ? 'Open this day in the register' : 'Take the register for this day'}
        </button>
      )}
    >
      {record ? (
        <dl className="risk-note__facts day-facts">
          {record.status === 'absent' && (
            <div><dt>Reason</dt><dd>{REASON_TEXT[record.reason] ?? 'Not given'}</dd></div>
          )}
          <div><dt>How it was taken</dt><dd>{METHOD_TEXT[record.captureMethod] ?? 'Recorded'}</dd></div>
          {saved && <div><dt>{record.updatedAt ? 'Last changed' : 'Saved'}</dt><dd>{saved}</dd></div>}
          <div><dt>Sent to the school</dt><dd>{record.syncedAt ? 'Yes' : 'Waiting for internet'}</dd></div>
        </dl>
      ) : (
        <p className="risk-note__summary">No attendance was recorded for this day.</p>
      )}
    </Modal>
  );
}

/** Month calendar of school days with the student's status on each, plus holidays and breaks. */
function AttendanceCalendar({ history, onOpenDay }) {
  const today = toISO(new Date());
  const [picked, setPicked] = useState(null);
  const records = useMemo(() => new Map(history.map((r) => [r.date, r])), [history]);
  const first = history.length ? history[0].date : today;

  const subtitle = (month) => {
    const prefix = month.slice(0, 7);
    const n = { present: 0, absent: 0 };
    for (const r of history) if (r.date.startsWith(prefix) && r.status in n) n[r.status] += 1;
    return `This month: ${n.present} days at school, ${n.absent} absent`;
  };

  return (
    <MonthCalendar
      title="Attendance calendar"
      subtitle={subtitle}
      firstMonth={first}
      selected={picked}
      onPick={setPicked}
      legend={[
        { tone: 'present', label: 'At school' },
        { tone: 'absent', label: 'Absent' },
        { tone: 'none', label: 'Not taken' },
      ]}
      getDay={(iso) => {
        const r = records.get(iso);
        if (!r) return { tone: 'none', text: 'Not taken' };
        if (r.status === 'absent') return { tone: 'absent', text: 'Absent', sub: r.reason ? REASON_TEXT[r.reason] : null };
        return { tone: 'present', text: CAL_TEXT[r.status] };
      }}
    >
      <p className="att-cal__hint">Click a day to see its details.</p>
      {picked && (
        <DayDialog iso={picked} record={records.get(picked)} onOpenDay={onOpenDay} onClose={() => setPicked(null)} />
      )}
    </MonthCalendar>
  );
}

function ProfilePage({ children }) {
  return <div className="profile-page">{children}</div>;
}

export default function StudentProfile({ studentId, className, onOpenDay }) {
  const [student, setStudent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followUp, setFollowUp] = useState({ lastAt: new Map() });
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [s, h] = await Promise.all([getStudentById(studentId), getStudentHistory(studentId)]);
      if (cancelled) return;
      setStudent(s);
      setHistory(h);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [studentId]);

  const [followUpTick, setFollowUpTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getFollowUpSummary([studentId]).then((summary) => { if (!cancelled) setFollowUp(summary); });
    return () => { cancelled = true; };
  }, [studentId, followUpTick]);

  const model = useMemo(() => {
    const asOf = toISO(new Date());
    const rows = history.map((r) => ({ date: r.date, status: r.status }));
    const features = computeFeatures(rows, asOf);
    const risk = scoreRiskML(rows, asOf);
    const insights = riskInsights(rows, features, risk, asOf);

    return { rows, features, risk, insights, assessable: isAssessable(rows) };
  }, [history]);

  if (loading) return <ProfilePage><p className="empty">Loading profile…</p></ProfilePage>;
  if (!student) return <ProfilePage><p className="empty">Student not found.</p></ProfilePage>;

  const { rows, risk, insights, features, assessable } = model;
  const enrolled = student.enrolledAt ? fmtDate(student.enrolledAt).long : '-';
  const counts = { present: 0, absent: 0 };
  for (const r of history) if (r.status in counts) counts[r.status] += 1;
  const recorded = counts.present + counts.absent;
  const overallRate = recorded ? counts.present / recorded : null;
  const flagged = assessable && risk.flag !== 'green';
  const lastFollowUp = followUp.lastAt.get(studentId);

  return (
    <ProfilePage>
      <section className="panel panel--pad profile-head">
        <Avatar name={student.fullName} size="lg" />
        <div className="profile-head__id">
          <h2 className="profile-head__name">{student.fullName}</h2>
          <p className="profile-head__meta">
            <span>Adm. No. <b>{student.admissionNo || '-'}</b></span>
            <span>Class <b>{className}</b></span>
            <span>Card <b>{student.cardUid || 'not issued'}</b></span>
            <span>Enrolled <b>{enrolled}</b></span>
          </p>
        </div>
        <div className="profile-head__status">
          {assessable ? (
            <span className={`risk-tag risk-tag--${risk.flag}`}>
              <span className={`dot dot--${risk.flag === 'red' ? 'absent' : risk.flag === 'amber' ? 'warn' : 'present'}`} />
              {RISK_LABEL[risk.flag]}
            </span>
          ) : (
            <span className="risk-tag">Not yet assessed</span>
          )}
          {flagged && (
            <span className="profile-head__followup">
              {lastFollowUp
                ? `Followed up ${new Date(lastFollowUp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                : 'Not yet followed up'}
            </span>
          )}
        </div>
      </section>

      <div className="stat-strip stat-strip--5">
        <div>
          <span className="stat-strip__label">Attendance (all records)</span>
          <span className="stat-strip__value">{overallRate == null ? '-' : `${Math.round(overallRate * 100)}%`}</span>
        </div>
        <div>
          <span className="stat-strip__label">Last 2 weeks</span>
          <span className="stat-strip__value">
            {features.attendance_rate_w1 == null ? '-' : `${Math.round(features.attendance_rate_w1 * 100)}%`}
          </span>
        </div>
        <div>
          <span className="stat-strip__label">Days present</span>
          <span className="stat-strip__value">{counts.present}</span>
        </div>
        <div>
          <span className="stat-strip__label">Days absent</span>
          <span className="stat-strip__value">{counts.absent}</span>
        </div>
        <div>
          <span className="stat-strip__label">Trend</span>
          <span className="stat-strip__value">{trendLabel(features.attendance_trend) ?? '-'}</span>
        </div>
      </div>

      <div className="profile-grid">
        <div className="profile-grid__main">
          <section className="panel panel--pad">
            <AttendanceCalendar history={history} onOpenDay={onOpenDay} />
          </section>
        </div>

        <aside className="profile-grid__side">
          <section
            className={`panel panel--pad${assessable ? ' risk-card' : ''}`}
            {...(assessable && {
              role: 'button',
              tabIndex: 0,
              'aria-haspopup': 'dialog',
              'aria-label': 'Absenteeism risk. Open the explanation',
              onClick: () => setShowBreakdown(true),
              onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowBreakdown(true);
                }
              },
            })}
          >
            <h3 className="panel__title">Absenteeism risk</h3>
            {assessable ? (
              <>
                <div className="risk-score">
                  <span className="risk-score__value">{Math.round(risk.dropoutProbability * 100)}%</span>
                  <span className="risk-score__label">predicted chance of continued absence</span>
                </div>
                <div className="meter__track risk-score__track">
                  <span
                    className={`meter__fill meter__fill--${risk.flag === 'red' ? 'red' : 'amber'}`}
                    style={{ width: `${Math.round(risk.dropoutProbability * 100)}%` }}
                  />
                </div>
                {RISK_TAKEAWAY[risk.flag] && <p className="risk-score__takeaway">{RISK_TAKEAWAY[risk.flag]}</p>}
                {flagged && insights.length > 0 && (
                  <>
                    <h4 className="panel__subtitle">Why flagged</h4>
                    <ul className="reason-list">
                      {insights.map((text, i) => (
                        <li key={i} className={`reason-list__item reason-list__item--${risk.flag}`}>{text}</li>
                      ))}
                    </ul>
                  </>
                )}
                <span className="risk-card__more">
                  <InfoIcon size={14} />
                  See a simple explanation
                </span>
              </>
            ) : (
              <p className="panel__sub" style={{ marginTop: 8 }}>
                Not enough attendance yet to assess risk. A prediction appears after about two weeks of records.
              </p>
            )}
          </section>
          {/* Outside the card: clicks inside the pop-up would otherwise bubble up and reopen it. */}
          {showBreakdown && (
            <RiskDialog
              student={student}
              rows={rows}
              features={features}
              risk={risk}
              reasons={flagged ? insights : undefined}
              onClose={() => setShowBreakdown(false)}
            />
          )}

          {flagged && (
            <FollowUpCard
              studentId={studentId}
              flag={risk.flag}
              student={student}
              onStudentUpdated={(updated) => setStudent((s) => ({ ...s, ...updated }))}
              onChanged={() => setFollowUpTick((n) => n + 1)}
            />
          )}
        </aside>
      </div>
    </ProfilePage>
  );
}
