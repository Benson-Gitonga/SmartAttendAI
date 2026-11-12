/**
 * SHAP explanations for the risk model: how much each feature pushed one
 * student's score up or down, compared with a reference group.
 *
 * Method: exact *interventional* TreeSHAP, the same quantity as Python's
 * `shap.TreeExplainer(model, background, feature_perturbation="interventional")`.
 * The exported model (data/riskModel.json) keeps each tree's splits but not
 * the training sample counts per node, which the default "path-dependent"
 * TreeSHAP needs; interventional SHAP needs only the trees and a background
 * set, and is exact.
 *
 * How it is computed: the model's raw output (log-odds) is a sum of trees, and
 * Shapley values add up across a sum, so each tree is explained on its own.
 * A tree only reads a few features (its trees have at most 7 leaves), so for
 * every background row we evaluate the tree on all mixes of "this student's
 * value" and "the background row's value" over those features and apply the
 * Shapley formula exactly. The result is averaged over the background rows.
 *
 * Values are in log-odds. They satisfy: base + sum(values) = the student's
 * raw score, where base is the background's average raw score.
 */

import mlModel from '../data/riskModel.json';
import { absenceReasonSummary, computeFeatures, computeMlExtraFeatures, toISO } from './riskModel';

export const MODEL_FEATURES = mlModel.features;

/** The model's 12 inputs for one student, in model order (null when unknown). */
export function mlFeatureVector(history, asOf = toISO(new Date())) {
  const all = { ...computeFeatures(history, asOf), ...computeMlExtraFeatures(history, asOf) };
  return MODEL_FEATURES.map((name) => {
    const v = all[name];
    return v == null || Number.isNaN(v) ? null : v;
  });
}

// ---------------------------------------------------------------- the maths

function walk(tree, x) {
  let i = 0;
  while (!tree.isLeaf[i]) {
    const v = x[tree.feature[i]];
    const goLeft = v == null || Number.isNaN(v) ? tree.missingLeft[i] : v <= tree.threshold[i];
    i = goLeft ? tree.left[i] : tree.right[i];
  }
  return tree.value[i];
}

/** Raw model output (log-odds) for an ordered feature vector. */
export function rawScore(x, model = mlModel) {
  let raw = model.baseline;
  for (const tree of model.trees) raw += walk(tree, x);
  return raw;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** The distinct features each tree splits on, computed once per model. */
const treeFeatureCache = new WeakMap();
function treeFeatures(model) {
  let out = treeFeatureCache.get(model);
  if (!out) {
    out = model.trees.map((t) => [...new Set(t.feature.filter((f, i) => !t.isLeaf[i] && f >= 0))]);
    treeFeatureCache.set(model, out);
  }
  return out;
}

/** Shapley weights |S|!(n-|S|-1)!/n! for a game of n players, by |S|. */
const weightCache = new Map();
function shapleyWeights(n) {
  if (!weightCache.has(n)) {
    const fact = [1];
    for (let i = 1; i <= n; i += 1) fact[i] = fact[i - 1] * i;
    weightCache.set(n, Array.from({ length: n }, (_, s) => (fact[s] * fact[n - s - 1]) / fact[n]));
  }
  return weightCache.get(n);
}

const popcount = (m) => { let c = 0; while (m) { m &= m - 1; c += 1; } return c; };

/**
 * Add one tree's exact interventional Shapley values for x against a single
 * background row r into `phi`. The players are groups of features
 * (`groupOf[feature]` = group index): switching a group to the student's
 * values switches all of its features together.
 */
function addTreeShap(tree, feats, groupOf, x, r, phi, scratch) {
  // Groups this tree reads where the student and the background row differ;
  // any other group cannot change this tree's output.
  const players = [];
  const members = [];
  for (const f of feats) {
    if (x[f] === r[f]) continue;
    const g = groupOf[f];
    let j = players.indexOf(g);
    if (j < 0) { j = players.length; players.push(g); members.push([]); }
    members[j].push(f);
  }
  const n = players.length;
  if (n === 0) return;

  for (let f = 0; f < r.length; f += 1) scratch[f] = r[f];
  const size = 1 << n;
  const v = new Float64Array(size);
  for (let mask = 0; mask < size; mask += 1) {
    for (let j = 0; j < n; j += 1) {
      const fromStudent = mask & (1 << j);
      for (const f of members[j]) scratch[f] = fromStudent ? x[f] : r[f];
    }
    v[mask] = walk(tree, scratch);
  }

  const w = shapleyWeights(n);
  for (let j = 0; j < n; j += 1) {
    const bit = 1 << j;
    let total = 0;
    for (let mask = 0; mask < size; mask += 1) {
      if (mask & bit) continue;
      total += w[popcount(mask)] * (v[mask | bit] - v[mask]);
    }
    phi[players[j]] += total;
  }
}

/**
 * Exact interventional SHAP values for one student.
 *
 * @param {Array<number|null>} x  the student's features, in model order
 * @param {Array<Array<number|null>>} background  reference rows, same order
 * @param {{ groups?: number[][], model?: object }} [opts]
 *   groups: lists of feature indices explained together as one player
 *   (exact group Shapley values). Default: every feature on its own.
 * @returns {{ values: number[], base: number, raw: number,
 *             probability: number, baseProbability: number }}
 *   values[i] is player i's contribution in log-odds; base + sum = raw.
 */
export function shapValues(x, background, { groups, model = mlModel } = {}) {
  if (!background.length) throw new Error('shapValues: background is empty');
  const nFeatures = model.features.length;
  const playerGroups = groups ?? model.features.map((_, i) => [i]);
  const groupOf = new Array(nFeatures).fill(-1);
  playerGroups.forEach((g, gi) => g.forEach((f) => { groupOf[f] = gi; }));
  if (groupOf.includes(-1)) throw new Error('shapValues: every feature must be in a group');

  const feats = treeFeatures(model);
  const nPlayers = playerGroups.length;
  const values = new Array(nPlayers).fill(0);
  const scratch = new Array(nFeatures);
  const phi = new Array(nPlayers);

  let base = 0;
  for (const r of background) {
    phi.fill(0);
    model.trees.forEach((tree, t) => addTreeShap(tree, feats[t], groupOf, x, r, phi, scratch));
    for (let p = 0; p < nPlayers; p += 1) values[p] += phi[p];
    base += rawScore(r, model);
  }
  for (let p = 0; p < nPlayers; p += 1) values[p] /= background.length;
  base /= background.length;

  const raw = rawScore(x, model);
  return { values, base, raw, probability: sigmoid(raw), baseProbability: sigmoid(base) };
}

// ------------------------------------------------------- for the student UI

/** Classmates with at least this many records make up the reference group. */
const MIN_PEER_RECORDS = 10;
const MIN_PEERS = 3;
const MAX_PEERS = 40;

/** The same student, had they come to school on every day they have a record for. */
/**
 * A typical classmate: the median of each feature across classmates (null
 * when none of them has a value). Explaining against this one row, rather
 * than averaging over every classmate, keeps each factor's direction in line
 * with "this student vs a typical classmate": with the monotonic model, a
 * worse value than the typical classmate can only raise risk. Averaged over
 * every classmate, one very low attender could outweigh the rest.
 */
export function typicalClassmate(peerVectors) {
  return MODEL_FEATURES.map((_, i) => {
    const v = peerVectors.map((p) => p[i]).filter((z) => z != null && !Number.isNaN(z)).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  });
}

function fullAttendanceReference(history, asOf) {
  return mlFeatureVector(history.map((r) => ({ date: r.date, status: 'present' })), asOf);
}

/**
 * The factors a teacher sees, one per model input (the fee and illness rates,
 * always 0 in the app, share one). The model is trained with monotonic
 * constraints (ml/training/retrain_monotonic.py) and each student is
 * explained against one typical classmate, so a value worse than the typical
 * classmate's can only raise risk: every factor points the way its numbers
 * suggest. `consistent` below double-checks that.
 *
 * `worseWhen` says which way a factor should push risk: 'lower' (a lower
 * value than the comparison should raise risk) or 'higher'. `measure` is the
 * number compared for that check and shown to the teacher.
 */
const avg = (vals) => {
  const v = vals.filter((z) => z != null && !Number.isNaN(z));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const pct = (v) => `${Math.round(v * 100)}%`;
const one = (key, label, feature, worseWhen, format) => ({
  key, label, features: [feature], worseWhen, measure: (f) => f[feature], format,
});
export const FACTOR_GROUPS = [
  one('w1', 'Attendance in the last 2 weeks', 'attendance_rate_w1', 'lower', pct),
  one('w2', 'Attendance 2 to 4 weeks ago', 'attendance_rate_w2', 'lower', pct),
  one('w3', 'Attendance 4 to 6 weeks ago', 'attendance_rate_w3', 'lower', pct),
  one('trend', 'Change over the last month', 'attendance_trend', 'lower',
    (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} points`),
  one('term', 'Attendance this term', 'attendance_rate_term', 'lower', pct),
  one('career', 'Attendance since joining', 'attendance_rate_career', 'lower', pct),
  one('streak', 'Longest run of absent days', 'longest_absence_streak', 'higher',
    (v) => `${Math.round(v * 10) / 10} day${Math.round(v) === 1 ? '' : 's'}`),
  one('episodes', 'Separate absences', 'absence_episode_count', 'higher', (v) => `${Math.round(v * 10) / 10}`),
  one('weekday', 'Absences on the same weekday', 'dow_concentration', 'higher', (v) => `${pct(v)} on one day`),
  {
    key: 'reasons',
    label: 'Absences for fees or illness',
    features: ['fee_absence_rate', 'health_absence_rate'],
    worseWhen: 'higher',
    measure: (f) => avg([f.fee_absence_rate, f.health_absence_rate]),
    format: pct,
  },
  one('timing', 'Point in the term', 'days_into_term', null, (v) => `day ${Math.round(v)}`), // context, not good or bad
];

/** Factors smaller than this (log-odds) are not worth showing. */
export const MIN_IMPACT = 0.02;

const named = (vector) => Object.fromEntries(MODEL_FEATURES.map((f, i) => [f, vector[i]]));

/**
 * Why the model scored this student as it did, for the risk pop-up.
 *
 * @param {Array<{date: string, status: string}>} history the student's records
 * @param {Array<Array<{date: string, status: string}>>} peerHistories classmates' records
 * @returns {{ comparedWith: 'classmates'|'full_attendance', peers: number,
 *             probability: number, baseProbability: number,
 *             factors: Array<Factor>, shown: Array<Factor>, hidden: number,
 *             reasons: ReturnType<typeof absenceReasonSummary> }}
 *   Factor = { key, label, impact, student, comparison, consistent }:
 *   impact is the group's SHAP value in log-odds (positive raises risk);
 *   student / comparison are formatted values; consistent is false when the
 *   model's push goes against the data (e.g. better attendance than the class
 *   but "raises risk"), which a model without monotonic constraints can do.
 *   `shown` are the consistent factors big enough to matter, largest first.
 */
export function explainStudentRisk(history, peerHistories = [], asOf = toISO(new Date())) {
  const x = mlFeatureVector(history, asOf);
  const peers = peerHistories
    .filter((h) => h.length >= MIN_PEER_RECORDS)
    .slice(0, MAX_PEERS)
    .map((h) => mlFeatureVector(h, asOf));

  const useClass = peers.length >= MIN_PEERS;
  const background = [useClass ? typicalClassmate(peers) : fullAttendanceReference(history, asOf)];
  const idx = Object.fromEntries(MODEL_FEATURES.map((f, i) => [f, i]));
  const shap = shapValues(x, background, { groups: FACTOR_GROUPS.map((g) => g.features.map((f) => idx[f])) });

  const xs = named(x);
  const bs = background.map(named);
  const factors = FACTOR_GROUPS.map((g, gi) => {
    const sv = g.measure(xs);
    const cv = avg(bs.map((b) => g.measure(b)));
    const impact = shap.values[gi];
    let consistent = true;
    if (g.worseWhen && sv != null && cv != null) {
      const diff = sv - cv;
      if (Math.abs(diff) < 1e-9) consistent = false; // same as the class: nothing to explain
      else consistent = (g.worseWhen === 'lower' ? diff < 0 : diff > 0) === impact > 0;
    }
    return {
      key: g.key,
      label: g.label,
      impact,
      student: sv == null ? 'no data' : g.format(sv),
      comparison: cv == null ? null : g.format(cv),
      consistent,
    };
  }).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  const big = factors.filter((f) => Math.abs(f.impact) >= MIN_IMPACT);
  const shown = big.filter((f) => f.consistent);
  return {
    comparedWith: useClass ? 'classmates' : 'full_attendance',
    peers: useClass ? peers.length : 0,
    probability: shap.probability,
    baseProbability: shap.baseProbability,
    factors,
    shown,
    hidden: big.length - shown.length,
    reasons: absenceReasonSummary(history, asOf),
  };
}
