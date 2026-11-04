import mlModel from '../data/riskModel.json';
import { shapValues, rawScore, explainStudentRisk, mlFeatureVector, MODEL_FEATURES, FACTOR_GROUPS, MIN_IMPACT } from './riskExplain';

const n = MODEL_FEATURES.length;
const idx = Object.fromEntries(MODEL_FEATURES.map((f, i) => [f, i]));

/** A feature vector from a few named values; the rest are typical. */
function vec(overrides = {}) {
  const base = {
    attendance_rate_w1: 0.9, attendance_rate_w2: 0.9, attendance_rate_w3: 0.9,
    longest_absence_streak: 1, absence_episode_count: 1, dow_concentration: 0.2,
    attendance_trend: 0, fee_absence_rate: 0, health_absence_rate: 0,
    attendance_rate_term: 0.9, days_into_term: 30, attendance_rate_career: 0.9,
  };
  const all = { ...base, ...overrides };
  return MODEL_FEATURES.map((f) => all[f]);
}

/** Textbook Shapley values over all 2^12 coalitions of the whole model. */
function bruteForceShap(x, r) {
  const fact = [1];
  for (let i = 1; i <= n; i += 1) fact[i] = fact[i - 1] * i;
  const v = new Float64Array(1 << n);
  for (let mask = 0; mask < 1 << n; mask += 1) {
    v[mask] = rawScore(x.map((xi, i) => (mask & (1 << i) ? xi : r[i])));
  }
  return MODEL_FEATURES.map((_, i) => {
    let total = 0;
    for (let mask = 0; mask < 1 << n; mask += 1) {
      if (mask & (1 << i)) continue;
      let s = 0; for (let m = mask; m; m &= m - 1) s += 1;
      total += ((fact[s] * fact[n - s - 1]) / fact[n]) * (v[mask | (1 << i)] - v[mask]);
    }
    return total;
  });
}

describe('shapValues (exact interventional TreeSHAP)', () => {
  const struggling = vec({
    attendance_rate_w1: 0.4, attendance_rate_w2: 0.6, longest_absence_streak: 4,
    absence_episode_count: 5, attendance_trend: -0.2, attendance_rate_term: 0.55, attendance_rate_career: 0.62,
  });
  const steady = vec();

  it('matches a brute-force Shapley calculation over the whole model', () => {
    const fast = shapValues(struggling, [steady]).values;
    const slow = bruteForceShap(struggling, steady);
    fast.forEach((v, i) => expect(v).toBeCloseTo(slow[i], 9));
  });

  it('adds up: base + sum of values = the student’s raw score', () => {
    const background = [steady, vec({ attendance_rate_w1: 0.8, days_into_term: 10 }), vec({ attendance_rate_career: 0.75 })];
    const { values, base, raw } = shapValues(struggling, background);
    expect(base + values.reduce((a, b) => a + b, 0)).toBeCloseTo(raw, 9);
    expect(raw).toBeCloseTo(rawScore(struggling), 12);
    expect(base).toBeCloseTo(background.reduce((s, r) => s + rawScore(r), 0) / background.length, 12);
  });

  it('gives zero to features the student shares with the background', () => {
    const { values } = shapValues(vec({ attendance_rate_w1: 0.3 }), [steady]);
    MODEL_FEATURES.forEach((f, i) => { if (f !== 'attendance_rate_w1') expect(values[i]).toBe(0); });
    expect(values[idx.attendance_rate_w1]).toBeGreaterThan(0); // worse attendance raises risk
  });

  it('handles missing values the way the model does', () => {
    const missing = vec({ attendance_rate_w3: null });
    const { values, base, raw } = shapValues(missing, [steady]);
    expect(base + values.reduce((a, b) => a + b, 0)).toBeCloseTo(raw, 9);
  });

  it('groups: exact group Shapley values that still add up', () => {
    const background = [steady, vec({ attendance_rate_career: 0.8 })];
    const groups = FACTOR_GROUPS.map((g) => g.features.map((f) => idx[f]));
    expect(groups.flat().sort((a, b) => a - b)).toEqual(MODEL_FEATURES.map((_, i) => i)); // every feature, once
    const { values, base, raw } = shapValues(struggling, background, { groups });
    expect(values).toHaveLength(FACTOR_GROUPS.length);
    expect(base + values.reduce((a, b) => a + b, 0)).toBeCloseTo(raw, 9);
  });

  it('groups of one feature give the same answer as no grouping', () => {
    const singles = MODEL_FEATURES.map((_, i) => [i]);
    const a = shapValues(struggling, [steady]).values;
    const b = shapValues(struggling, [steady], { groups: singles }).values;
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 12));
  });

  it('is fast enough for a phone: one student against 40 classmates', () => {
    const background = Array.from({ length: 40 }, (_, k) => vec({ attendance_rate_w1: 0.5 + k / 100, days_into_term: 10 + k }));
    const t0 = performance.now();
    shapValues(struggling, background);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(mlModel.trees.length).toBeGreaterThan(0);
  });
});

describe('explainStudentRisk', () => {
  const asOf = '2026-10-21';
  function history(absentEvery, days = 70) {
    const out = [];
    const end = new Date(2026, 9, 21);
    for (let d = days; d >= 1; d -= 1) {
      const day = new Date(end); day.setDate(end.getDate() - d);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      out.push({ date: iso, status: absentEvery && out.length % absentEvery === 0 ? 'absent' : 'present' });
    }
    return out;
  }

  it('compares with classmates and ranks the biggest factors first', () => {
    const student = history(2); // absent every other day
    const classmates = [history(0), history(10), history(8), history(12)];
    const e = explainStudentRisk(student, classmates, asOf);
    expect(e.comparedWith).toBe('classmates');
    expect(e.peers).toBe(4);
    expect(e.factors).toHaveLength(FACTOR_GROUPS.length);
    const sizes = e.factors.map((f) => Math.abs(f.impact));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(e.probability).toBeGreaterThan(e.baseProbability);

    // Worse attendance than the class, so attendance is shown raising risk.
    const attendance = e.shown.find((f) => ['w1', 'w2', 'w3', 'term', 'career'].includes(f.key));
    expect(attendance).toBeDefined();
    expect(attendance.impact).toBeGreaterThan(0);
    expect(parseInt(attendance.student, 10)).toBeLessThan(parseInt(attendance.comparison, 10));
  });

  it('only shows factors that agree with the data, and counts the rest', () => {
    const e = explainStudentRisk(history(2), [history(0), history(10), history(8), history(12)], asOf);
    expect(e.shown.every((f) => f.consistent && Math.abs(f.impact) >= MIN_IMPACT)).toBe(true);
    const big = e.factors.filter((f) => Math.abs(f.impact) >= MIN_IMPACT);
    expect(e.hidden).toBe(big.filter((f) => !f.consistent).length);
  });

  it('falls back to full attendance when there are too few classmates', () => {
    const student = history(3);
    const e = explainStudentRisk(student, [history(0)], asOf);
    expect(e.comparedWith).toBe('full_attendance');
    expect(mlFeatureVector(student, asOf)).toHaveLength(MODEL_FEATURES.length);
  });
});

describe('explanations point the way the numbers do (monotonic model + typical classmate)', () => {
  const asOf = '2026-10-21';
  // Deterministic pseudo-random registers, so the test is repeatable.
  function seeded(seed) {
    let s = seed;
    return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  }
  function randomHistory(rand, absentRate, days = 150) {
    const out = [];
    const end = new Date(2026, 9, 21);
    for (let d = days; d >= 1; d -= 1) {
      const day = new Date(end); day.setDate(end.getDate() - d);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      out.push({ date: iso, status: rand() < absentRate ? 'absent' : 'present' });
    }
    return out;
  }

  it('never shows a factor that contradicts the student vs typical-classmate figures', () => {
    const rand = seeded(7);
    let checked = 0;
    for (let c = 0; c < 6; c += 1) {
      const klass = Array.from({ length: 12 }, () => randomHistory(rand, rand() * 0.5));
      klass.forEach((student, i) => {
        const e = explainStudentRisk(student, klass.filter((_, j) => j !== i), asOf);
        expect(e.hidden).toBe(0);
        for (const f of e.factors) if (Math.abs(f.impact) >= MIN_IMPACT) expect(f.consistent).toBe(true);
        checked += 1;
      });
    }
    expect(checked).toBe(72);
  });
});
