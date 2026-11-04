#!/usr/bin/env python
"""Metrics of a saved model at given red thresholds (amber = red x 0.35/0.60),
on the same SCH-01 test dates and SCH-02 holdout as retrain_monotonic.py.

    ./venv/Scripts/python.exe training/threshold_check.py models/best_model_monotonic.pkl 0.25 0.27 --sch01 <xlsx> --sch02 <xlsx>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import joblib

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from retrain_monotonic import metrics  # noqa: E402
from temporal_split import temporal_train_test_split  # noqa: E402
from train import LABEL_HORIZON_DAYS, LABEL_NAME, TEST_SIZE, _locate, _xy, supervised_table  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("model", type=Path)
    ap.add_argument("thresholds", type=float, nargs="+")
    ap.add_argument("--sch01", type=Path, default=None)
    ap.add_argument("--sch02", type=Path, default=None)
    args = ap.parse_args(argv)

    model = joblib.load(args.model)["model"]
    t01 = supervised_table(args.sch01 or _locate("SCH-01")).dropna(subset=[LABEL_NAME]).reset_index(drop=True)
    t02 = supervised_table(args.sch02 or _locate("SCH-02")).dropna(subset=[LABEL_NAME]).reset_index(drop=True)
    _, test01 = temporal_train_test_split(t01, test_size=TEST_SIZE, date_col="as_of", gap=LABEL_HORIZON_DAYS)
    sets = {"SCH-01 test": _xy(test01), "SCH-02": _xy(t02)}

    print(f"{'red':>5} {'set':<12} {'redP':>6} {'redR':>6} {'redF1':>6} {'red%':>6} {'amberT':>7} {'amb+P':>6} {'amb+R':>6} {'amb+%':>6} {'amb+FPR':>7}")
    for t in args.thresholds:
        for name, (X, y) in sets.items():
            m = metrics(y, model.predict_proba(X)[:, 1], t)
            r, a = m["red"], m["amber_or_red"]
            print(f"{t:5.2f} {name:<12} {r['precision']:6.3f} {r['recall']:6.3f} {r['f1']:6.3f} {r['share_flagged']:6.1%} {a['threshold']:7.4f} {a['precision']:6.3f} {a['recall']:6.3f} {a['share_flagged']:6.1%} {a['fp_rate']:7.1%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
