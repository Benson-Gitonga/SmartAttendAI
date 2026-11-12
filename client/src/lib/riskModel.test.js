import {
  absenceReasonSummary,
  REASON_COVERAGE_MIN,
  computeFeatures,
  computeMlExtraFeatures,
  detectPatterns,
  riskInsights,
  scoreRisk,
  scoreRiskFromFeatures,
  scoreRiskML,
  weeklyTrend,
  isAssessable,
  isSchoolDay,
  toISO,
} from './riskModel';

/** Build a history of the N school days ending the day before `asOf`. */
function historyEndingBefore(asOf, count, statusFor) {
  const rows = [];
  let d = new Date(asOf);
  d.setDate(d.getDate() - 1);
  while (rows.length < count) {
    const iso = toISO(d);
    if (isSchoolDay(iso)) rows.unshift({ date: iso, status: statusFor(rows.length) });
    d.setDate(d.getDate() - 1);
  }
  return rows;
}

const AS_OF = '2026-09-07'; // a Monday

describe('computeFeatures', () => {
  it('is all-present: rate 1, no streak, no episodes', () => {
    const history = historyEndingBefore(AS_OF, 30, () => 'present');
    const f = computeFeatures(history, AS_OF);
    expect(f.attendance_rate_w1).toBe(1);
    expect(f.attendance_rate_w2).toBe(1);
    expect(f.longest_absence_streak).toBe(0);
    expect(f.absence_episode_count).toBe(0);
    expect(f.attendance_trend).toBe(0);
  });

  it('counts a missing record on a school day as an absence', () => {
    // only two old records, so the recent windows are empty
    const f = computeFeatures(
      [{ date: '2026-07-01', status: 'present' }],
      AS_OF
    );
    expect(f.attendance_rate_w1).toBe(0);
    expect(f.longest_absence_streak).toBeGreaterThan(0);
  });

  it('reports a downward trend when recent weeks are worse', () => {
    const history = historyEndingBefore(AS_OF, 30, (i) => (i < 5 ? 'absent' : 'present'));
    // i counts from the most recent (unshift), so the last 5 school days are absent
    const f = computeFeatures(history, AS_OF);
    expect(f.attendance_trend).toBeLessThan(0);
    expect(f.longest_absence_streak).toBe(5);
  });
});

describe('scoreRisk matches the Python RuleBasedScorer', () => {
  it('flags green for a student who always attends', () => {
    const f = computeFeatures(historyEndingBefore(AS_OF, 30, () => 'present'), AS_OF);
    expect(scoreRisk(f).flag).toBe('green');
  });

  it('hard-overrides to red at a 5-day absence streak', () => {
    const f = computeFeatures(
      historyEndingBefore(AS_OF, 30, (i) => (i < 5 ? 'absent' : 'present')),
      AS_OF
    );
    const r = scoreRisk(f);
    expect(f.longest_absence_streak).toBe(5);
    expect(r.overridden).toBe(true);
    expect(r.flag).toBe('red');
    expect(r.dropoutProbability).toBeGreaterThanOrEqual(0.75);
  });

  it('flags amber in the middle band', () => {
    // a recent 3-day absence on top of a patchy month, but no 5-day override
    const f = computeFeatures(
      historyEndingBefore(AS_OF, 28, (i) => (i < 3 || i % 3 === 0 ? 'absent' : 'present')),
      AS_OF
    );
    const r = scoreRisk(f);
    expect(f.longest_absence_streak).toBeLessThan(5);
    expect(r.score).toBeGreaterThanOrEqual(0.35);
    expect(r.score).toBeLessThan(0.6);
    expect(r.flag).toBe('amber');
  });

  it('reads a missing rate feature as "attended", not as risk', () => {
    const r = scoreRisk({
      attendance_rate_w1: null,
      attendance_rate_w2: null,
      longest_absence_streak: 0,
      dow_concentration: 0,
      attendance_trend: null,
    });
    expect(r.score).toBe(0);
    expect(r.flag).toBe('green');
  });
});

describe('weeklyTrend', () => {
  it('returns one point per week, newest last', () => {
    const t = weeklyTrend(historyEndingBefore(AS_OF, 40, () => 'present'), AS_OF, 6);
    expect(t).toHaveLength(6);
    expect(t.map((p) => p.label)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5', 'W6']);
    expect(t.every((p) => p.rate === 1)).toBe(true);
  });
});

describe('scoreRiskFromFeatures matches the Python model exactly', () => {
  // Expected values from the Python tree walk that export_model.py checks
  // against predict_proba() before writing riskModel.json. A mismatch means
  // the JS port and the Python model have diverged. Recompute after a re-export.
  const CASES = [
    {
      name: 'steady attender',
      features: {
        attendance_rate_w1: 1.0, attendance_rate_w2: 1.0, attendance_rate_w3: 1.0,
        longest_absence_streak: 0, absence_episode_count: 0, dow_concentration: 0.0,
        attendance_trend: 0.0, fee_absence_rate: 0.0, health_absence_rate: 0.0,
        attendance_rate_term: 0.95, days_into_term: 40, attendance_rate_career: 0.96,
      },
      probability: 0.04128021,
      flag: 'green',
    },
    {
      name: 'chronic absentee',
      features: {
        attendance_rate_w1: 0.1, attendance_rate_w2: 0.2, attendance_rate_w3: 0.3,
        longest_absence_streak: 8, absence_episode_count: 3, dow_concentration: 0.4,
        attendance_trend: -0.1, fee_absence_rate: 0.3, health_absence_rate: 0.1,
        attendance_rate_term: 0.15, days_into_term: 50, attendance_rate_career: 0.3,
      },
      probability: 0.95128749,
      flag: 'red',
    },
    {
      name: 'missing windows (nulls) - early in a term, thin history',
      features: {
        attendance_rate_w1: 0.6, attendance_rate_w2: null, attendance_rate_w3: null,
        longest_absence_streak: 2, absence_episode_count: 1, dow_concentration: 0.5,
        attendance_trend: null, fee_absence_rate: 0.0, health_absence_rate: 0.0,
        attendance_rate_term: null, days_into_term: null, attendance_rate_career: null,
      },
      probability: 0.14470469,
      flag: 'green',
    },
    {
      name: 'borderline case, just over the red threshold',
      features: {
        attendance_rate_w1: 0.75, attendance_rate_w2: 0.8, attendance_rate_w3: 0.7,
        longest_absence_streak: 3, absence_episode_count: 2, dow_concentration: 0.33,
        attendance_trend: -0.05, fee_absence_rate: 0.0, health_absence_rate: 0.2,
        attendance_rate_term: 0.78, days_into_term: 20, attendance_rate_career: 0.75,
      },
      probability: 0.27776779,
      flag: 'red',
    },
    {
      name: 'same student with a better long-run record drops to amber',
      features: {
        attendance_rate_w1: 0.75, attendance_rate_w2: 0.8, attendance_rate_w3: 0.7,
        longest_absence_streak: 3, absence_episode_count: 2, dow_concentration: 0.33,
        attendance_trend: -0.05, fee_absence_rate: 0.0, health_absence_rate: 0.2,
        attendance_rate_term: 0.78, days_into_term: 20, attendance_rate_career: 0.78,
      },
      probability: 0.19950213,
      flag: 'amber',
    },
  ];

  it.each(CASES)('$name', ({ features, probability, flag }) => {
    const r = scoreRiskFromFeatures(features);
    expect(r.dropoutProbability).toBeCloseTo(probability, 6);
    expect(r.flag).toBe(flag);
  });
});

describe('computeMlExtraFeatures', () => {
  it('falls back to null term features outside any known term (holiday gap)', () => {
    // 2026-04-20 sits between Term 1 (ends Apr 3) and Term 2 (starts May 4).
    const f = computeMlExtraFeatures([], '2026-04-20');
    expect(f.attendance_rate_term).toBeNull();
    expect(f.days_into_term).toBeNull();
  });

  it('computes term rate/days from the start of the containing term', () => {
    const history = historyEndingBefore('2026-01-19', 10, () => 'present'); // inside Term 1
    const f = computeMlExtraFeatures(history, '2026-01-19');
    expect(f.days_into_term).toBeGreaterThan(0);
    expect(f.attendance_rate_term).not.toBeNull();
  });

  it('career rate counts term-time school days from the first record', () => {
    // Present 2026-07-27..08-07 (end of Term 2), then nothing until AS_OF
    // (2026-09-07): the Aug holiday is skipped, Sep 1-4 count as absences.
    const history = historyEndingBefore('2026-08-08', 10, () => 'present');
    const f = computeMlExtraFeatures(history, AS_OF);
    expect(f.attendance_rate_career).toBeCloseTo(10 / 14, 6);
  });

  it('career rate skips public holidays and is null with no history', () => {
    // Term 2 from 2026-05-25 to 06-05: 10 weekdays, two of them holidays
    // (Idd-ul-Azha 05-27, Madaraka Day 06-01). Present on the other 8.
    const history = historyEndingBefore('2026-06-06', 10, () => 'present')
      .filter((r) => r.date !== '2026-05-27' && r.date !== '2026-06-01');
    expect(computeMlExtraFeatures(history, '2026-06-06').attendance_rate_career).toBe(1);
    expect(computeMlExtraFeatures([], AS_OF).attendance_rate_career).toBeNull();
  });

  it('fee/health absence rate are 0 when no reasons are recorded', () => {
    const f = computeMlExtraFeatures(historyEndingBefore(AS_OF, 20, () => 'absent'), AS_OF);
    expect(f.fee_absence_rate).toBe(0);
    expect(f.health_absence_rate).toBe(0);
  });
});

/** Absent every school day; `reasonFor(i)` gives day i's reason (0 = most recent). */
function absentWithReasons(count, reasonFor) {
  return historyEndingBefore(AS_OF, count, () => 'absent').reverse()
    .map((r, i) => ({ ...r, reason: reasonFor(i) })).reverse();
}

describe('absence reasons in the risk score', () => {
  it('uses the fee and sick rates when most absences have a reason', () => {
    // Every absence has a reason: half fees, three in ten sick, the rest other.
    const history = absentWithReasons(40, (i) => (i % 10 < 5 ? 'fee' : i % 10 < 8 ? 'health' : 'other'));
    const s = absenceReasonSummary(history, AS_OF);
    expect(s.marked).toBe(s.absences);
    expect(s.fee + s.health + s.other).toBe(s.marked);
    expect(s.coverage).toBe(1);
    expect(s.used).toBe(true);

    const f = computeMlExtraFeatures(history, AS_OF);
    expect(f.fee_absence_rate).toBeCloseTo(s.fee / s.absences, 9);
    expect(f.health_absence_rate).toBeCloseTo(s.health / s.absences, 9);
    expect(f.fee_absence_rate).toBeGreaterThan(0.4);
    expect(f.health_absence_rate).toBeGreaterThan(0.2);
  });

  it('leaves reasons out when too few absences have one', () => {
    const history = absentWithReasons(40, (i) => (i % 2 === 0 ? 'fee' : null));
    const s = absenceReasonSummary(history, AS_OF);
    expect(s.coverage).toBeLessThan(REASON_COVERAGE_MIN);
    expect(s.used).toBe(false);
    expect(s.notGiven).toBeGreaterThan(0);
    const f = computeMlExtraFeatures(history, AS_OF);
    expect(f.fee_absence_rate).toBe(0);
    expect(f.health_absence_rate).toBe(0);
  });

  it('counts the reasons once the share reaches the bar', () => {
    // 3 in 10 not given: 70% exactly when the window holds a multiple of 10.
    const history = absentWithReasons(40, (i) => (i % 10 < 3 ? null : 'health'));
    const s = absenceReasonSummary(history, AS_OF);
    expect(s.used).toBe(s.coverage >= REASON_COVERAGE_MIN);
    expect(s.coverage).toBeGreaterThanOrEqual(0.65);
  });

  it('does not count "unknown" as a recorded reason', () => {
    const history = absentWithReasons(40, () => 'unknown');
    const s = absenceReasonSummary(history, AS_OF);
    expect(s.coverage).toBe(0);
    expect(s.notGiven).toBe(s.marked);
    expect(s.used).toBe(false);
    expect(computeMlExtraFeatures(history, AS_OF).fee_absence_rate).toBe(0);
  });

  it('gives the same score as before when no reasons are recorded', () => {
    const plain = historyEndingBefore(AS_OF, 40, (i) => (i % 4 === 0 ? 'absent' : 'present'));
    const withNulls = plain.map((r) => ({ ...r, reason: null }));
    expect(scoreRiskML(withNulls, AS_OF).score).toBe(scoreRiskML(plain, AS_OF).score);
  });

  it('fee and sick reasons can only raise the score', () => {
    const plain = historyEndingBefore(AS_OF, 40, (i) => (i % 3 === 0 ? 'absent' : 'present'));
    const tagged = (reason) => plain.map((r) => (r.status === 'absent' ? { ...r, reason } : r));
    const base = scoreRiskML(plain, AS_OF).score;
    expect(scoreRiskML(tagged('fee'), AS_OF).score).toBeGreaterThanOrEqual(base);
    expect(scoreRiskML(tagged('health'), AS_OF).score).toBeGreaterThan(base);
    expect(scoreRiskML(tagged('other'), AS_OF).score).toBe(base);
  });

  it('ignores a reason on a day the student was present', () => {
    const history = historyEndingBefore(AS_OF, 40, () => 'present').map((r) => ({ ...r, reason: 'fee' }));
    const s = absenceReasonSummary(history, AS_OF);
    expect(s.absences).toBe(0);
    expect(s.used).toBe(false);
  });
});

describe('scoreRiskML end-to-end from history', () => {
  it('flags a student with a long recent absence streak as red', () => {
    const history = historyEndingBefore(AS_OF, 30, (i) => (i >= 22 ? 'absent' : 'present'));
    const r = scoreRiskML(history, AS_OF);
    expect(r.flag).toBe('red');
    expect(r.dropoutProbability).toBeGreaterThan(0.3);
  });
});

describe('detectPatterns', () => {
  const weekday = (iso) => new Date(`${iso}T00:00`).getDay();

  it('flags 4 school days absent in a row as red', () => {
    // The last 4 school days before Mon Sep 7: Tue 1 .. Fri 4.
    const history = historyEndingBefore(AS_OF, 20, (i) => (i < 4 ? 'absent' : 'present'));
    const [p] = detectPatterns(history, AS_OF);
    expect(p).toMatchObject({
      kind: 'streak', flag: 'red', days: 4, ongoing: true, from: '2026-09-01', to: '2026-09-04',
    });
  });

  it('counts a run across a weekend, and notices the student came back', () => {
    // Fri Aug 28, Mon 31, Tue Sep 1, Wed 2 absent; back Thu 3.
    const history = historyEndingBefore(AS_OF, 20, (i) => (i >= 2 && i <= 5 ? 'absent' : 'present'));
    const [p] = detectPatterns(history, AS_OF);
    expect(p).toMatchObject({ days: 4, ongoing: false, from: '2026-08-28', to: '2026-09-02' });
  });

  it('does not flag 3 days in a row', () => {
    const history = historyEndingBefore(AS_OF, 20, (i) => (i < 3 ? 'absent' : 'present'));
    expect(detectPatterns(history, AS_OF)).toEqual([]);
  });

  it('skips days with no register instead of counting them as absences', () => {
    // 2 absences, a day with no record, 2 more absences: a 4-day run, not broken.
    const history = historyEndingBefore(AS_OF, 20, (i) => (i < 5 ? 'absent' : 'present'))
      .filter((r) => r.date !== '2026-09-02');
    expect(detectPatterns(history, AS_OF)[0]).toMatchObject({ kind: 'streak', days: 4 });
    // And no records at all is not a streak.
    expect(detectPatterns([], AS_OF)).toEqual([]);
  });

  it('flags 3 of the last 4 Mondays as amber', () => {
    let mondaysSeen = 0;
    const history = historyEndingBefore(AS_OF, 30, () => 'present').reverse().map((r) => {
      if (weekday(r.date) !== 1) return r;
      mondaysSeen += 1;
      // newest first: miss the 1st, 2nd and 4th most recent Mondays
      return { ...r, status: [1, 2, 4].includes(mondaysSeen) ? 'absent' : 'present' };
    }).reverse();
    expect(detectPatterns(history, AS_OF)).toEqual([
      { kind: 'weekday', flag: 'amber', weekday: 'Monday', missed: 3, of: 4 },
    ]);
  });

  it('does not call general absence a weekday habit', () => {
    const history = historyEndingBefore(AS_OF, 30, (i) => (i % 2 === 0 ? 'absent' : 'present'));
    expect(detectPatterns(history, AS_OF).some((p) => p.kind === 'weekday')).toBe(false);
  });
});

describe('scoreRiskML with patterns', () => {
  it('keeps the model score but raises the flag on a 4-day streak', () => {
    const history = historyEndingBefore(AS_OF, 30, (i) => (i < 4 ? 'absent' : 'present'));
    const r = scoreRiskML(history, AS_OF);
    expect(r.flag).toBe('red');
    expect(r.patterns[0].kind).toBe('streak');
    expect(r.overridden).toBe(r.mlFlag !== 'red');
    expect(riskInsights(history, computeFeatures(history, AS_OF), r, AS_OF)[0]).toMatch(
      /^Absent 4 school days in a row and not back yet/
    );
  });

  it('leaves the model flag alone when no pattern fires', () => {
    const history = historyEndingBefore(AS_OF, 30, () => 'present');
    const r = scoreRiskML(history, AS_OF);
    expect(r.patterns).toEqual([]);
    expect(r.flag).toBe(r.mlFlag);
    expect(r.overridden).toBe(false);
  });
});

describe('isAssessable', () => {
  it('needs at least 8 recorded school days', () => {
    expect(isAssessable(historyEndingBefore(AS_OF, 7, () => 'present'))).toBe(false);
    expect(isAssessable(historyEndingBefore(AS_OF, 8, () => 'present'))).toBe(true);
  });
});
