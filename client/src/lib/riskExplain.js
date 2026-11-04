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
import { computeFeatures, computeMlExtraFeatures, toISO } from './riskModel';

export const MODEL_FEATURES = mlModel.features;

/** Plain-language names for the teacher. */
export const FEATURE_LABELS = {
  attendance_rate_w1: 'Attendance in the last 2 weeks',
  attendance_rate_w2: 'Attendance 2 to 4 weeks ago',
  attendance_rate_w3: 'Attendance 4 to 6 weeks ago',
  longest_absence_streak: 'Longest run of absent days',
  absence_episode_count: 'Separate absences',
  dow_concentration: 'Absences bunched on one weekday',
  attendance_trend: 'Recent change in attendance',
  fee_absence_rate: 'Absences for school fees',
  health_absence_rate: 'Absences for illness',
  attendance_rate_term: 'Attendance this term',
  days_into_term: 'How far into the term',
  attendance_rate_career: 'Attendance since joining',
};

const pct = (v) => `${Math.round(v * 100)}%`;
const FORMAT = {
  attendance_rate_w1: pct,
  attendance_rate_w2: pct,
  attendance_rate_w3: pct,
  attendance_rate_term: pct,
  attendance_rate_career: pct,
  fee_absence_rate: pct,
  health_absence_rate: pct,
  dow_concentration: pct,
  attendance_trend: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} points`,
  longest_absence_streak: (v) => `${v} day${v === 1 ? '' : 's'}`,
  absence_episode_count: (v) => `${v}`,
  days_into_term: (v) => `day ${v}`,
};

/** A feature's value, formatted for the teacher. */
export function formatFeature(name, value) {
  if (value == null || Number.isNaN(value)) return 'no data';
  return (FORMAT[name] ?? String)(value);
}

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
 * background row r into `phi`.
 */
function addTreeShap(tree, feats, x, r, phi, scratch) {
  // Features where x and r agree cannot change this tree's output.
  const players = feats.filter((f) => x[f] !== r[f]);
  const n = players.length;
  if (n === 0) return;

  for (let f = 0; f < r.length; f += 1) scratch[f] = r[f];
  const size = 1 << n;
  const v = new Float64Array(size);
  for (let mask = 0; mask < size; mask += 1) {
    for (let j = 0; j < n; j += 1) scratch[players[j]] = mask & (1 << j) ? x[players[j]] : r[players[j]];
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
 * @returns {{ values: number[], base: number, raw: number,
 *             probability: number, baseProbability: number }}
 *   values[i] is feature i's contribution in log-odds; base + sum = raw.
 */
export function shapValues(x, background, model = mlModel) {
  if (!background.length) throw new Error('shapValues: background is empty');
  const nFeatures = model.features.length;
  const feats = treeFeatures(model);
  const values = new Array(nFeatures).fill(0);
  const scratch = new Array(nFeatures);
  const phi = new Array(nFeatures);

  let base = 0;
  for (const r of background) {
    phi.fill(0);
    model.trees.forEach((tree, t) => addTreeShap(tree, feats[t], x, r, phi, scratch));
    for (let f = 0; f < nFeatures; f += 1) values[f] += phi[f];
    base += rawScore(r, model);
  }
  for (let f = 0; f < nFeatures; f += 1) values[f] /= background.length;
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
function fullAttendanceReference(history, asOf) {
  return mlFeatureVector(history.map((r) => ({ date: r.date, status: 'present' })), asOf);
}

/**
 * Why the model scored this student as it did, for the profile.
 *
 * @param {Array<{date: string, status: string}>} history the student's records
 * @param {Array<Array<{date: string, status: string}>>} peerHistories classmates' records
 * @returns {{ comparedWith: 'classmates'|'full_attendance', peers: number,
 *             probability: number, baseProbability: number,
 *             factors: Array<{ feature: string, label: string, value: string, impact: number }> }}
 *   factors are sorted by size of impact (log-odds); positive raises risk.
 */
export function explainStudentRisk(history, peerHistories = [], asOf = toISO(new Date())) {
  const x = mlFeatureVector(history, asOf);
  const peers = peerHistories
    .filter((h) => h.length >= MIN_PEER_RECORDS)
    .slice(0, MAX_PEERS)
    .map((h) => mlFeatureVector(h, asOf));

  const useClass = peers.length >= MIN_PEERS;
  const background = useClass ? peers : [fullAttendanceReference(history, asOf)];
  const shap = shapValues(x, background);

  const factors = MODEL_FEATURES
    .map((feature, i) => ({
      feature,
      label: FEATURE_LABELS[feature] ?? feature,
      value: formatFeature(feature, x[i]),
      impact: shap.values[i],
    }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return {
    comparedWith: useClass ? 'classmates' : 'full_attendance',
    peers: useClass ? peers.length : 0,
    probability: shap.probability,
    baseProbability: shap.baseProbability,
    factors,
  };
}
