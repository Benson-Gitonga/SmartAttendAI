/**
 * Client-side absenteeism risk.
 *
 * `scoreRiskML` runs the trained model exported to `data/riskModel.json` by
 * `ml/training/export_model.py`. Re-export that file whenever the model is
 * retrained. `detectPatterns` adds hard rules on top: a pattern can raise the
 * model's flag but never lower it. `scoreRisk` is the older rule-based
 * scorer, kept as a fallback.
 *
 * Features follow the Python pipeline in `ml/training/`:
 *   - windows are 14 / 28 calendar days, counting only school days (Mon-Fri);
 *   - a school day with no record counts as an absence;
 *   - present and late both count as attended;
 *   - a rate is null only when its window has no school days.
 */

import mlModel from '../data/riskModel.json';

export const FEATURE_NAMES = [
  'attendance_rate_w1',
  'attendance_rate_w2',
  'attendance_rate_w3',
  'longest_absence_streak',
  'absence_episode_count',
  'dow_concentration',
  'attendance_trend',
];

const WEEK = 7;
const WINDOW_DAYS = 14;
const MONTH_DAYS = 28;
const SIX_WEEK_DAYS = 42;
const ATTENDED = new Set(['present', 'late']);

/** RuleBasedScorer.WEIGHTS */
export const RISK_WEIGHTS = {
  consecutive: 0.4, // longest_absence_streak
  monthly_rate: 0.3, // 1 - mean(rate_w1, rate_w2)
  day_of_week: 0.15, // dow_concentration
  trend: 0.15, // max(0, -attendance_trend)
};
const CONSECUTIVE_NORM = 5;
const AMBER_THRESHOLD = 0.35;
const RED_THRESHOLD = 0.6;
const OVERRIDE_STREAK = 5;

// Date helpers: 'YYYY-MM-DD' strings in local time.

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(iso, n) {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}
export function isSchoolDay(iso) {
  const g = parseISO(iso).getDay();
  return g >= 1 && g <= 5;
}
function schoolDaysBetween(startISO, endISO) {
  const out = [];
  for (let d = startISO; d < endISO; d = addDays(d, 1)) {
    if (isSchoolDay(d)) out.push(d);
  }
  return out;
}

/**
 * @param {Array<{date: string, status: string}>} history
 * @param {string} asOf  exclusive upper bound ('YYYY-MM-DD'); defaults to today
 * @returns {{[k: string]: number|null}} the 7 features
 */
export function computeFeatures(history, asOf = toISO(new Date())) {
  const byDate = new Map(history.map((r) => [r.date, r.status]));

  const windowRate = (startISO, endISO) => {
    const days = schoolDaysBetween(startISO, endISO);
    if (days.length === 0) return null;
    const attended = days.filter((d) => ATTENDED.has(byDate.get(d))).length;
    return attended / days.length;
  };

  const w1End = asOf;
  const w1Start = addDays(asOf, -WINDOW_DAYS);
  const w2Start = addDays(asOf, -WINDOW_DAYS * 2);
  const w3Start = addDays(asOf, -WINDOW_DAYS * 3);

  const rate_w1 = windowRate(w1Start, w1End);
  const rate_w2 = windowRate(w2Start, w1Start);
  const rate_w3 = windowRate(w3Start, w2Start);

  const monthDays = schoolDaysBetween(addDays(asOf, -MONTH_DAYS), asOf);
  const isAbsent = (d) => !ATTENDED.has(byDate.get(d));

  let longestStreak = 0;
  let currentStreak = 0;
  let episodes = 0;
  let prevAbsent = false;
  const dowCounts = new Map();
  let totalAbsences = 0;

  for (const d of monthDays) {
    if (isAbsent(d)) {
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      if (!prevAbsent) episodes += 1;
      const g = parseISO(d).getDay();
      dowCounts.set(g, (dowCounts.get(g) || 0) + 1);
      totalAbsences += 1;
      prevAbsent = true;
    } else {
      currentStreak = 0;
      prevAbsent = false;
    }
  }

  const maxDow = dowCounts.size ? Math.max(...dowCounts.values()) : 0;
  const dow_concentration = totalAbsences === 0 ? 0 : maxDow / totalAbsences;

  const attendance_trend =
    rate_w1 === null || rate_w2 === null ? null : rate_w1 - rate_w2;

  return {
    attendance_rate_w1: rate_w1,
    attendance_rate_w2: rate_w2,
    attendance_rate_w3: rate_w3,
    longest_absence_streak: longestStreak,
    absence_episode_count: episodes,
    dow_concentration,
    attendance_trend,
  };
}

// Kenya term dates, copied from ml/training/kenya_calendar.json. Update every
// school year; outside a known term the two term features are null.
const KENYA_TERMS = [
  { name: 'Term 1 2026', start: '2026-01-05', end: '2026-04-03' },
  { name: 'Term 2 2026', start: '2026-05-04', end: '2026-08-07' },
  { name: 'Term 3 2026', start: '2026-09-01', end: '2026-12-04' },
];

// Public holidays inside the terms above, from the same JSON. Only the career
// rate skips them, since it spans months.
const KENYA_TERM_HOLIDAYS = new Set(['2026-03-20', '2026-04-03', '2026-05-27', '2026-06-01', '2026-10-20']);

const isTermSchoolDay = (iso) =>
  isSchoolDay(iso) && !KENYA_TERM_HOLIDAYS.has(iso) && termContaining(iso) !== null;

/**
 * Attendance rate from the student's first record up to `asOf`, counting only
 * term-time school days, like the training calendar. Null with no history.
 */
function careerRate(history, byDate, asOf) {
  let first = null;
  for (const r of history) {
    if (r.date < asOf && isTermSchoolDay(r.date) && (first === null || r.date < first)) first = r.date;
  }
  if (first === null) return null;
  const days = schoolDaysBetween(first, asOf).filter(isTermSchoolDay);
  return days.filter((d) => ATTENDED.has(byDate.get(d))).length / days.length;
}

function termContaining(asOf) {
  return KENYA_TERMS.find((t) => t.start <= asOf && asOf <= t.end) ?? null;
}

export function recordedSchoolDays(history) {
  return history.filter((r) => isSchoolDay(r.date) && r.status).length;
}

/** Below this many recorded school days the risk score is not shown. */
export const MIN_ASSESSABLE_DAYS = 8;

export function isAssessable(history) {
  return recordedSchoolDays(history) >= MIN_ASSESSABLE_DAYS;
}

// Rule-based scorer

const clip01 = (x) => Math.min(1, Math.max(0, x));
const rateOr1 = (v) => (v == null || Number.isNaN(v) ? 1 : v);
const numOr0 = (v) => (v == null || Number.isNaN(v) ? 0 : v);

/**
 * @param {ReturnType<typeof computeFeatures>} f
 * @returns {{
 *   score: number, flag: 'green'|'amber'|'red', dropoutProbability: number,
 *   overridden: boolean,
 *   components: { consecutive: number, monthly_rate: number, day_of_week: number, trend: number }
 * }}
 */
export function scoreRisk(f) {
  const streak = numOr0(f.longest_absence_streak);

  const components = {
    consecutive: clip01(streak / CONSECUTIVE_NORM),
    monthly_rate: clip01(
      1 - (rateOr1(f.attendance_rate_w1) + rateOr1(f.attendance_rate_w2)) / 2
    ),
    day_of_week: clip01(numOr0(f.dow_concentration)),
    trend: clip01(-numOr0(f.attendance_trend)),
  };

  const score =
    RISK_WEIGHTS.consecutive * components.consecutive +
    RISK_WEIGHTS.monthly_rate * components.monthly_rate +
    RISK_WEIGHTS.day_of_week * components.day_of_week +
    RISK_WEIGHTS.trend * components.trend;

  const overridden = streak >= OVERRIDE_STREAK;
  const flag =
    score >= RED_THRESHOLD || overridden ? 'red' : score >= AMBER_THRESHOLD ? 'amber' : 'green';

  const dropoutProbability = clip01(overridden ? Math.max(score, 0.75) : score);

  return { score, flag, dropoutProbability, overridden, components };
}

export function breakdownRows(components) {
  return [
    { key: 'day_of_week', label: 'Day pattern', value: components.day_of_week },
    { key: 'consecutive', label: 'Consecutive absences', value: components.consecutive },
    { key: 'monthly_rate', label: 'Monthly rate', value: components.monthly_rate },
    { key: 'trend', label: 'Trend direction', value: components.trend },
  ];
}

// Trained model

/**
 * The 5 extra features the trained model uses. The app does not record absence
 * reasons, so the fee and health rates are always 0, as in training. The
 * career rate needs the student's full history, not just the recent weeks.
 */
export function computeMlExtraFeatures(history, asOf = toISO(new Date())) {
  const byDate = new Map(history.map((r) => [r.date, r.status]));
  const term = termContaining(asOf);

  let rate_term = null;
  let days_into_term = null;
  if (term) {
    const days = schoolDaysBetween(term.start, asOf);
    days_into_term = days.length;
    rate_term = days.length
      ? days.filter((d) => ATTENDED.has(byDate.get(d))).length / days.length
      : null;
  }

  return {
    fee_absence_rate: 0,
    health_absence_rate: 0,
    attendance_rate_term: rate_term,
    days_into_term,
    attendance_rate_career: careerRate(history, byDate, asOf),
  };
}

// Attendance patterns: hard rules on top of the model

/** This many school days marked absent in a row always flags red. */
export const PERSISTENT_STREAK_DAYS = 4;
/** Missing this many of the last WEEKDAY_LOOKBACK same weekdays flags amber. */
export const WEEKDAY_HABIT_MISSES = 3;
const WEEKDAY_LOOKBACK = 4;

const DOW_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FLAG_RANK = { green: 0, amber: 1, red: 2 };
export const worseFlag = (a, b) => (FLAG_RANK[b] > FLAG_RANK[a] ? b : a);

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const shortDate = (iso) => SHORT_DATE.format(parseISO(iso));

/**
 * Patterns that flag a student whatever the model says. Only days with a
 * record count: a school day with no register (a holiday, a closure, a missed
 * roll call) neither adds to nor breaks a run.
 *
 * @returns {Array<
 *   | { kind: 'streak', flag: 'red', days: number, from: string, to: string, ongoing: boolean }
 *   | { kind: 'weekday', flag: 'amber', weekday: string, missed: number, of: number }
 * >}
 */
export function detectPatterns(history, asOf = toISO(new Date())) {
  const byDate = new Map(history.map((r) => [r.date, r.status]));
  const out = [];

  // Persistent absence: the longest run of recorded absences in the last 4 weeks.
  const recorded = schoolDaysBetween(addDays(asOf, -MONTH_DAYS), asOf).filter((d) => byDate.has(d));
  let best = null;
  let runStart = null;
  recorded.forEach((d, i) => {
    if (byDate.get(d) === 'absent') {
      if (runStart === null) runStart = i;
      const days = i - runStart + 1;
      if (!best || days >= best.days) best = { days, from: recorded[runStart], to: d, end: i };
    } else {
      runStart = null;
    }
  });
  if (best && best.days >= PERSISTENT_STREAK_DAYS) {
    out.push({
      kind: 'streak',
      flag: 'red',
      days: best.days,
      from: best.from,
      to: best.to,
      ongoing: best.end === recorded.length - 1,
    });
  }

  // Weekday habit: the same weekday missed again and again (e.g. 3 of the last 4 Mondays).
  const byWeekday = new Map();
  for (const d of schoolDaysBetween(addDays(asOf, -SIX_WEEK_DAYS), asOf)) {
    if (!byDate.has(d)) continue;
    const g = parseISO(d).getDay();
    if (!byWeekday.has(g)) byWeekday.set(g, []);
    byWeekday.get(g).push(byDate.get(d));
  }
  const habits = [];
  for (const [g, statuses] of byWeekday) {
    const last = statuses.slice(-WEEKDAY_LOOKBACK);
    if (last.length < WEEKDAY_HABIT_MISSES) continue;
    const missed = last.filter((st) => st === 'absent').length;
    if (missed >= WEEKDAY_HABIT_MISSES) habits.push({ g, missed, of: last.length });
  }
  // Missing most days of the week is general absence, not a weekday habit.
  if (habits.length >= 1 && habits.length <= 2) {
    habits.sort((a, b) => b.missed / b.of - a.missed / a.of);
    const h = habits[0];
    out.push({ kind: 'weekday', flag: 'amber', weekday: DOW_LABEL[h.g], missed: h.missed, of: h.of });
  }

  return out;
}

/** One sentence per pattern, for the Alerts table and the profile. */
export function describePattern(p) {
  if (p.kind === 'streak') {
    const span = p.from === p.to ? shortDate(p.from) : `${shortDate(p.from)} to ${shortDate(p.to)}`;
    return p.ongoing
      ? `Absent ${p.days} school days in a row and not back yet (since ${shortDate(p.from)}).`
      : `Missed ${p.days} school days in a row (${span}).`;
  }
  return `Missed ${p.missed} of the last ${p.of} ${p.weekday}s.`;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

function walkTree(tree, featureVector) {
  let i = 0;
  while (!tree.isLeaf[i]) {
    const v = featureVector[tree.feature[i]];
    const goLeft = v == null || Number.isNaN(v) ? tree.missingLeft[i] : v <= tree.threshold[i];
    i = goLeft ? tree.left[i] : tree.right[i];
  }
  return tree.value[i];
}

/**
 * @param {Array<number|null>} orderedFeatures in `mlModel.features` order
 * @returns {number} probability of persistent absenteeism, 0..1
 */
export function predictMlProbability(orderedFeatures) {
  let raw = mlModel.baseline;
  for (const tree of mlModel.trees) raw += walkTree(tree, orderedFeatures);
  return sigmoid(raw);
}

/** Same return shape as `scoreRisk`, with empty `components`. */
export function scoreRiskFromFeatures(allFeatures) {
  const ordered = mlModel.features.map((name) => {
    const v = allFeatures[name];
    return v == null || Number.isNaN(v) ? null : v;
  });
  const dropoutProbability = clip01(predictMlProbability(ordered));

  const flag =
    dropoutProbability >= mlModel.redThreshold
      ? 'red'
      : dropoutProbability >= mlModel.amberThreshold
        ? 'amber'
        : 'green';

  return { score: dropoutProbability, flag, dropoutProbability, overridden: false, components: {} };
}

/**
 * The model's prediction, raised by any attendance pattern. `score` and
 * `dropoutProbability` stay the model's own output; `mlFlag` is the flag
 * before patterns, and `overridden` is true when a pattern raised it.
 */
export function scoreRiskML(history, asOf = toISO(new Date())) {
  const base = computeFeatures(history, asOf);
  const extra = computeMlExtraFeatures(history, asOf);
  const ml = scoreRiskFromFeatures({ ...base, ...extra });
  const patterns = detectPatterns(history, asOf);
  const flag = patterns.reduce((f, pt) => worseFlag(f, pt.flag), ml.flag);
  return { ...ml, flag, mlFlag: ml.flag, overridden: flag !== ml.flag, patterns };
}

/**
 * Weekly attendance rate for the `weeks` weeks ending at `asOf`.
 * @returns {Array<{ label: string, weekStart: string, rate: number|null }>}
 */
export function weeklyTrend(history, asOf = toISO(new Date()), weeks = 6) {
  const byDate = new Map(history.map((r) => [r.date, r.status]));
  const out = [];
  for (let i = weeks; i >= 1; i -= 1) {
    const start = addDays(asOf, -WEEK * i);
    const end = addDays(asOf, -WEEK * (i - 1));
    const days = schoolDaysBetween(start, end);
    const rate = days.length
      ? days.filter((d) => ATTENDED.has(byDate.get(d))).length / days.length
      : null;
    out.push({ label: `W${weeks - i + 1}`, weekStart: start, rate });
  }
  return out;
}

function dominantAbsenceDay(history, asOf) {
  const byDate = new Map(history.map((r) => [r.date, r.status]));
  const counts = new Map();
  for (const d of schoolDaysBetween(addDays(asOf, -MONTH_DAYS), asOf)) {
    if (!ATTENDED.has(byDate.get(d))) {
      const g = parseISO(d).getDay();
      counts.set(g, (counts.get(g) || 0) + 1);
    }
  }
  let best = null;
  let bestN = 0;
  for (const [g, n] of counts) if (n > bestN) [best, bestN] = [g, n];
  return best == null ? null : { day: DOW_LABEL[best], count: bestN };
}

/** @returns {string[]} short insights for the Alerts card and profile */
export function riskInsights(history, features, risk, asOf = toISO(new Date())) {
  const patterns = risk.patterns ?? [];
  const out = patterns.map(describePattern);
  const streak = features.longest_absence_streak;

  if (streak >= 3 && !patterns.some((pt) => pt.kind === 'streak')) {
    const dom = dominantAbsenceDay(history, asOf);
    out.push(
      dom && dom.count >= 2 && features.dow_concentration >= 0.4
        ? `Missed ${streak} consecutive school days, clustered on ${dom.day}s.`
        : `Missed ${streak} consecutive school days in the last four weeks.`
    );
  }

  const r1 = features.attendance_rate_w1;
  const r3 = features.attendance_rate_w3;
  if (r1 != null && r3 != null && r3 - r1 >= 0.15) {
    out.push(
      `Attendance dropped from ${Math.round(r3 * 100)}% to ${Math.round(r1 * 100)}% over the last six weeks.`
    );
  } else if (features.attendance_trend != null && features.attendance_trend <= -0.1) {
    out.push('Attendance is trending downward week on week.');
  }

  if (features.absence_episode_count >= 3) {
    out.push(`${features.absence_episode_count} separate absence episodes this month, not just one bad week.`);
  }

  if (risk.flag === 'red' && out.length === 0) {
    out.push('This pattern points to a high risk of continued absence without a check-in.');
  } else if (risk.flag === 'amber' && out.length === 0) {
    // The model can flag amber without any of the patterns above.
    out.push('No single strong reason stands out, but the overall pattern is still worth a check-in.');
  }

  if (out.length === 0) out.push('Attendance is within the normal range this month.');
  return out;
}

export function riskHeadline(risk) {
  const pct = Math.round(risk.dropoutProbability * 100);
  return { label: 'Absenteeism risk', pct };
}
