#!/usr/bin/env python
"""Retrain the shipped model with monotonic constraints and compare.

The shipped model (tune.py's HistGradientBoosting) can push risk the "wrong"
way, e.g. a student with better attendance than the class scored as riskier,
which shows up in the app's SHAP explanations. Monotonic constraints rule
that out: lower attendance may only raise risk, longer absence runs may only
raise risk, and so on (see MONOTONIC below).

This script trains, on the same split and with the same settings:
  - "current":   the shipped settings (tuning_report.json), unconstrained
  - "monotonic": the same settings plus monotonic constraints
and compares both with the one-number baseline (career attendance rate) on
SCH-01's later dates and on SCH-02, which no model sees in training.

It writes results/monotonic_report.json (aggregate numbers only) and
models/best_model_monotonic.pkl. To ship the monotonic model, copy that file
over models/best_model.pkl and run export_model.py.

Usage (real student data, keep the cache out of synced folders):
    set SMARTATTEND_ML_DATA=%LOCALAPPDATA%\\smartattend-ml
    ./venv/Scripts/python.exe training/retrain_monotonic.py --sch01 <xlsx> --sch02 <xlsx>
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from temporal_split import ForwardChainingCV, temporal_train_test_split  # noqa: E402
from train import (  # noqa: E402
    FEATURE_NAMES,
    LABEL_HORIZON_DAYS,
    LABEL_NAME,
    MODELS_DIR,
    RESULTS_DIR,
    SEED,
    TEST_SIZE,
    _dataset_stats,
    _locate,
    _xy,
    supervised_table,
)
from tune import best_threshold_from_oof, oof_predict_proba  # noqa: E402

# +1: a higher value may only raise risk; -1: may only lower it; 0: free.
MONOTONIC = {
    "attendance_rate_w1": -1,
    "attendance_rate_w2": -1,
    "attendance_rate_w3": -1,
    "longest_absence_streak": +1,
    "absence_episode_count": +1,
    "dow_concentration": +1,       # bunched on one weekday: a habit, as the app's weekday rule
    "attendance_trend": -1,        # improving attendance may only lower risk
    "fee_absence_rate": +1,
    "health_absence_rate": +1,
    "attendance_rate_term": -1,
    "days_into_term": 0,           # context, not good or bad
    "attendance_rate_career": -1,
}

AMBER_FRACTION = 0.35 / 0.60  # as export_model.py


def shipped_params() -> dict:
    report = json.loads((RESULTS_DIR / "tuning_report.json").read_text(encoding="utf-8"))
    return dict(report["models"]["hist_gradient_boosting_tuned"]["best_params"])


def metrics(y, proba, red: float) -> dict:
    y = np.asarray(y, dtype=int)
    proba = np.asarray(proba, dtype=float)
    out = {
        "positive_rate": float(y.mean()),
        "roc_auc": float(roc_auc_score(y, proba)),
        "pr_auc": float(average_precision_score(y, proba)),
        "brier": float(brier_score_loss(y, proba)),
    }
    top = proba >= np.quantile(proba, 0.9)
    out["precision_top10pct"] = float(y[top].mean())
    for name, t in (("red", red), ("amber_or_red", red * AMBER_FRACTION)):
        flag = proba >= t
        tp = int((flag & (y == 1)).sum())
        fp = int((flag & (y == 0)).sum())
        fn = int((~flag & (y == 1)).sum())
        tn = int((~flag & (y == 0)).sum())
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        out[name] = {
            "threshold": float(t), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": p, "recall": r, "f1": 2 * p * r / (p + r) if p + r else 0.0,
            "share_flagged": float(flag.mean()), "fp_rate": fp / (fp + tn) if fp + tn else 0.0,
        }
    return out


def monotonic_violations(model, X: pd.DataFrame, n_rows: int = 500, seed: int = SEED) -> dict:
    """For each constrained feature: share of sampled rows where moving the
    feature in its "worse" direction lowers predicted risk (should be 0 for the
    monotonic model)."""
    rng = np.random.default_rng(seed)
    rows = X.iloc[rng.choice(len(X), size=min(n_rows, len(X)), replace=False)].reset_index(drop=True)
    out = {}
    for f, sign in MONOTONIC.items():
        if sign == 0:
            continue
        col = X[f].dropna()
        lo, hi = float(col.quantile(0.02)), float(col.quantile(0.98))
        grid = np.linspace(lo, hi, 9)
        bad = 0
        for _, row in rows.iterrows():
            frame = pd.DataFrame([row] * len(grid))
            frame[f] = grid
            p = model.predict_proba(frame[list(FEATURE_NAMES)])[:, 1]
            steps = np.diff(p) * sign  # should all be >= 0
            if (steps < -1e-9).any():
                bad += 1
        out[f] = bad / len(rows)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sch01", type=Path, default=None)
    ap.add_argument("--sch02", type=Path, default=None)
    ap.add_argument("--cv-splits", type=int, default=4)
    args = ap.parse_args(argv)

    t0 = time.time()
    print("Loading supervised tables (built and cached on the first run)...")
    table01 = supervised_table(args.sch01 or _locate("SCH-01")).dropna(subset=[LABEL_NAME]).reset_index(drop=True)
    table02 = supervised_table(args.sch02 or _locate("SCH-02")).dropna(subset=[LABEL_NAME]).reset_index(drop=True)
    train01, test01 = temporal_train_test_split(table01, test_size=TEST_SIZE, date_col="as_of", gap=LABEL_HORIZON_DAYS)
    X_train, y_train = _xy(train01)
    X_test, y_test = _xy(test01)
    X_hold, y_hold = _xy(table02)
    groups = train01["as_of"].to_numpy()
    cv = ForwardChainingCV(n_splits=args.cv_splits, gap=LABEL_HORIZON_DAYS)
    print(f"  train {len(X_train):,} | SCH-01 test {len(X_test):,} | SCH-02 {len(X_hold):,}  ({time.time() - t0:.0f}s)")

    params = shipped_params()
    cst = [MONOTONIC[f] for f in FEATURE_NAMES]
    candidates = {
        "current": HistGradientBoostingClassifier(random_state=SEED, **params),
        "monotonic": HistGradientBoostingClassifier(random_state=SEED, monotonic_cst=cst, **params),
    }

    report = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "params": params,
        "monotonic_cst": MONOTONIC,
        "datasets": {
            "sch01_train": _dataset_stats(train01),
            "sch01_test": _dataset_stats(test01),
            "sch02_holdout": _dataset_stats(table02),
        },
        "models": {},
    }
    fitted = {}
    for name, est in candidates.items():
        t1 = time.time()
        oof, covered = oof_predict_proba(est, X_train, y_train, cv, groups)
        red, oof_f1 = best_threshold_from_oof(y_train.to_numpy()[covered], oof[covered])
        model = clone(est).fit(X_train, y_train)
        fitted[name] = (model, red)
        report["models"][name] = {
            "red_threshold": red,
            "oof_f1": oof_f1,
            "sch01_test": metrics(y_test, model.predict_proba(X_test)[:, 1], red),
            "sch02_holdout": metrics(y_hold, model.predict_proba(X_hold)[:, 1], red),
            "wrong_way_share": monotonic_violations(model, X_test),
        }
        print(f"  {name}: trained in {time.time() - t1:.0f}s, red threshold {red:.2f}")

    # The baseline: career attendance rate alone (lower rate = higher risk).
    report["baseline_career_rate"] = {
        key: {
            "roc_auc": float(roc_auc_score(y, -X["attendance_rate_career"].fillna(X["attendance_rate_career"].median()))),
            "pr_auc": float(average_precision_score(y, -X["attendance_rate_career"].fillna(X["attendance_rate_career"].median()))),
        }
        for key, X, y in (("sch01_test", X_test, y_test), ("sch02_holdout", X_hold, y_hold))
    }

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "monotonic_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model, red = fitted["monotonic"]
    joblib.dump({"model": model, "threshold": red, "features": list(FEATURE_NAMES)}, MODELS_DIR / "best_model_monotonic.pkl")
    model, red = fitted["current"]
    joblib.dump({"model": model, "threshold": red, "features": list(FEATURE_NAMES)}, MODELS_DIR / "best_model_current_retrained.pkl")

    print("\n{:<12} {:<14} {:>7} {:>7} {:>9} {:>8} {:>8}".format("model", "set", "ROC", "PR", "red P", "red R", "flagged"))
    for name in candidates:
        for key in ("sch01_test", "sch02_holdout"):
            m = report["models"][name][key]
            print(f"{name:<12} {key:<14} {m['roc_auc']:7.3f} {m['pr_auc']:7.3f} {m['red']['precision']:9.3f} {m['red']['recall']:8.3f} {m['red']['share_flagged']:8.1%}")
    for key, b in report["baseline_career_rate"].items():
        print(f"{'baseline':<12} {key:<14} {b['roc_auc']:7.3f} {b['pr_auc']:7.3f}")
    for name in candidates:
        worst = max(report["models"][name]["wrong_way_share"].values())
        print(f"{name}: worst wrong-way share across constrained features = {worst:.1%}")
    print(f"\nsaved -> ml/results/monotonic_report.json, ml/models/best_model_monotonic.pkl  ({time.time() - t0:.0f}s total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
