# Machine Learning

Absence-risk pipeline for SmartAttend AI: predicts **persistent absenteeism**
(missing ≥ 30% of scheduled school days in a rolling 4-week window) from
attendance history, so staff get an early warning instead of finding out at
term's end.

## Layout

```
ml/
├── requirements.txt         pip lower-bounds (pandas, numpy, scikit-learn, scipy, joblib, openpyxl)
├── conftest.py              puts training/ on sys.path for pytest
├── training/
│   ├── feature_engineering.py   SchoolCalendar, compute_features(), compute_features_frame()
│   ├── compute_labels.py        compute_label(), absence_rate_in_window(), build_training_table()
│   ├── temporal_split.py        temporal_train_test_split(), ForwardChainingCV (expanding-window CV)
│   ├── kenya_calendar.json      term dates + public holidays
│   ├── train.py                 load -> label -> split -> train (RF / LogReg / rule-based) -> report
│   ├── tune.py                  RandomizedSearchCV + ForwardChainingCV over RF and HistGradientBoosting
│   └── export_model.py          walks the tuned model's trees into a plain-JSON asset for the JS runtime
├── tests/                    pytest tests over the feature/label/split logic
├── data/                     gitignored: cached supervised_*.pkl (slow to rebuild)
├── models/                   gitignored: trained model .pkl files
└── results/
    ├── evaluation_report.json   RF vs LogReg vs rule-based, on real SCH-01/SCH-02 data
    └── tuning_report.json       best_params + CV/holdout metrics per tuned model
```

## Features (11)

`attendance_rate_w1/w2/w3` (three trailing 14-day windows), `longest_absence_streak`,
`absence_episode_count`, `dow_concentration`, `attendance_trend` (w1 − w2),
`fee_absence_rate`, `health_absence_rate`, `attendance_rate_term`, `days_into_term`.

Windows are half-open `[start, as_of)` (no leakage); a missing record on a
scheduled school day counts as absent.

## Patterns on top of the model

The model predicts; it is not guaranteed to flag a pattern that has already
happened. So the app (`detectPatterns` in `client/src/lib/riskModel.js` and
`server/src/lib/riskModel.js`) adds two rules that can raise the model's flag
but never lower it:

| pattern | rule | flag |
|---|---|---|
| persistent absence | 4+ school days marked absent in a row, last 4 weeks | red |
| weekday habit | same weekday absent in 3 of its last 4 occurrences (1-2 weekdays only) | at least amber |

Only days with a register count, so a holiday or a missed roll call neither
starts nor breaks a run. The risk score shown is still the model's probability.

### Tried and dropped: streak and weekday features (2026-10-13)

Two extra features were trained and tuned on Colab with the full pipeline:
`current_absence_streak` (absences in a row up to `as_of`) and
`weekday_absence_excess` (worst single-weekday absence rate minus the overall
rate, last six weeks). They made no difference, so the model stays at 11 features:

| tuned HistGB | SCH-01 F1 | SCH-01 AUC | SCH-02 F1 | SCH-02 AUC |
|---|---|---|---|---|
| 11 features (shipped) | .480 | .706 | .484 | .771 |
| 13 features | .479 | .707 | .484 | .771 |

Permutation importance on SCH-02 (AUC drop when shuffled) was 0.0000 for
`current_absence_streak` and 0.0001 for `weekday_absence_excess`, against 0.122
for `attendance_rate_term`. The label (>= 30% absent over the next four weeks)
is driven by the term-long attendance rate, and the data has no real weekday
effect (absence is ~13% on every weekday). That is why both patterns are rules
in the app rather than model features.

## Current model

Tuned `HistGradientBoostingClassifier` (`max_leaf_nodes=7`, 210 trees). It was
chosen over the tuned Random Forest because its small trees keep the exported
model small enough to ship in the PWA.

| eval set | precision | recall | F1 | AUC |
|---|---|---|---|---|
| SCH-01 test | .383 | .648 | .482 | .706 |
| SCH-02 holdout | .408 | .599 | .485 | .771 |

Full params and both untuned baselines (RF, LogReg, rule-based) are in
`results/tuning_report.json` / `results/evaluation_report.json`.

## Running it

```bash
cd ml
python -m venv venv && ./venv/Scripts/python.exe -m pip install -r requirements.txt

# tests
./venv/Scripts/python.exe -m pytest tests/ -q

# train the baseline RF/LogReg/rule-based models (~19 min, needs SCH-01/SCH-02 xlsx)
./venv/Scripts/python.exe training/train.py

# hyperparameter + threshold tuning (RF + HistGradientBoosting)
./venv/Scripts/python.exe training/tune.py

# export the tuned model to JSON for client/ and server/ (self-verifying against predict_proba)
./venv/Scripts/python.exe training/export_model.py
```

`export_model.py` writes `client/src/data/riskModel.json` and
`server/src/data/riskModel.json`, which `riskModel.js` on each side walks
with plain arithmetic (`scoreRiskML`), so risk scoring works fully offline.

## Not yet done

- **SHAP-based explainability**: there is no per-student explanation of a
  score yet. The export only carries the tree structure.
