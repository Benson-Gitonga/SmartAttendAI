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

## Features (12)

`attendance_rate_w1/w2/w3` (three trailing 14-day windows), `longest_absence_streak`,
`absence_episode_count`, `dow_concentration`, `attendance_trend` (w1 − w2),
`fee_absence_rate`, `health_absence_rate`, `attendance_rate_term`, `days_into_term`,
`attendance_rate_career` (attendance from the student's first record up to `as_of`).

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
rate, last six weeks). They made no difference on the 11-feature model of the time:

| tuned HistGB | SCH-01 F1 | SCH-01 AUC | SCH-02 F1 | SCH-02 AUC |
|---|---|---|---|---|
| 11 features | .480 | .706 | .484 | .771 |
| 13 features | .479 | .707 | .484 | .771 |

Permutation importance on SCH-02 (AUC drop when shuffled) was 0.0000 for
`current_absence_streak` and 0.0001 for `weekday_absence_excess`, against 0.122
for `attendance_rate_term`. The label (>= 30% absent over the next four weeks)
is driven by the term-long attendance rate, and the data has no real weekday
effect (absence is ~13% on every weekday). That is why both patterns are rules
in the app rather than model features.

## Current model

`HistGradientBoostingClassifier` with the tuned settings from `tune.py`
(`max_leaf_nodes=7`, learning rate 0.053, up to 210 trees, 196 after early
stopping, 12 features, no class weighting) **plus monotonic constraints**
(`retrain_monotonic.py`, 2026-11-04): lower attendance (any window, this term,
since joining) and a worsening trend may only raise risk; longer absence runs,
more separate absences, more bunching on one weekday and more fee/illness
absences may only raise risk; the point in the term is left free. Red at 0.27,
amber at 0.1575.

The unconstrained model pushed the wrong way often: with everything else
fixed, raising last-fortnight or this-term attendance *raised* its risk on 100%
of sampled students, which made SHAP explanations contradict the numbers. The
constrained model does so on 0%, at the same accuracy:

| eval set | model | precision | recall | F1 | AUC | flagged red |
|---|---|---|---|---|---|---|
| SCH-01 test | unconstrained (was shipped) | .448 | .715 | .551 | .789 | 40% |
| SCH-01 test | **monotonic (shipped)** | **.452** | **.714** | **.554** | **.787** | **40%** |
| SCH-02 holdout | unconstrained (was shipped) | .486 | .677 | .566 | .842 | 27% |
| SCH-02 holdout | **monotonic (shipped)** | **.494** | **.669** | **.568** | **.842** | **26%** |

Baseline for honesty: the career attendance rate on its own scores AUC .789
(SCH-01) and .833 (SCH-02); the model adds little over it. The out-of-fold F1
search picked red 0.25 for the monotonic model; 0.27 (the earlier shipped
threshold) scores a higher F1 on both test sets and keeps amber above ordinary
attenders (1 absence in 10 days stays green), see `threshold_check.py`.

Full numbers: `results/monotonic_report.json`; the original tuning and
untuned baselines: `results/tuning_report.json` / `results/evaluation_report.json`.

### Retraining (real student data)

The SCH-01/SCH-02 workbooks are real school records: keep them out of the repo
and out of synced folders. Point the table cache outside the project too:

```bash
set SMARTATTEND_ML_DATA=%LOCALAPPDATA%\smartattend-ml
./venv/Scripts/python.exe training/retrain_monotonic.py --sch01 <SCH-01.xlsx> --sch02 <SCH-02.xlsx>
./venv/Scripts/python.exe training/threshold_check.py models/best_model_monotonic.pkl 0.25 0.27 0.30 --sch01 ... --sch02 ...
# copy models/best_model_monotonic.pkl to models/best_model.pkl (with the chosen threshold), then
./venv/Scripts/python.exe training/export_model.py
```

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

## Explanations (SHAP)

The risk pop-up shows "Why this score": SHAP values worked out on the phone
by `client/src/lib/riskExplain.js`, offline, against a **typical classmate**
(the median of each feature across the class; with fewer than 3 classmates on
record, the same student with full attendance).

- **Method:** exact interventional (baseline) Shapley values over the
  exported trees, as `shap.TreeExplainer(model, reference,
  feature_perturbation="interventional")`. The export has no per-node training
  counts, which path-dependent TreeSHAP needs. Each tree reads only a few
  features, so every coalition is evaluated exactly; tests check it against
  brute-force Shapley over all 4,096 coalitions of the full model.
- **Why it reads sensibly:** with the monotonic model and a single reference
  row, a value worse than the typical classmate's can only raise risk, so
  every factor points the way its numbers say. A test checks this over 72
  random students; on the demo school all 37 students' factors agree with
  their figures. (Averaging over every classmate instead let one very low
  attender outweigh the rest, and the unconstrained model contradicted the
  figures for about 1 in 5 factors shown.)
- A consistency filter remains as a safety net: a factor that went against
  the figures would be left out and counted in a note. It hides nothing with
  the current model.

## Not yet done

- **Fee and illness reasons in the app:** the model was trained with
  `fee_absence_rate` / `health_absence_rate`, but the app does not record
  absence reasons yet, so both are always 0 there.
