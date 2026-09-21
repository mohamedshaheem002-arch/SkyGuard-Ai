"""Step 2: train LightGBM detector (binary) + root-cause classifier, pick threshold on val, report on test.
Memory-lean: features are read from the float32 memmap and only the needed rows are copied."""
from __future__ import annotations

import json, sys, time
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score, average_precision_score, confusion_matrix

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
t0 = time.time()

obs = pd.read_parquet(ROOT / "data" / "obs.parquet", columns=["station_id", "ts", "label", "fault", "sensor", "event_id", "split", "genuine_event"])
qc = pd.read_parquet(ROOT / "data" / "qc.parquet")
names = joblib.load(ROOT / "data" / "feature_names.joblib")
ctx = joblib.load(ROOT / "models" / "context.joblib")
fcols = ctx["feature_cols"]
fidx = [names.index(c) for c in fcols]
X_all = np.load(ROOT / "data" / "features.npy", mmap_mode="r")
print(f"rows={len(obs):,} features={len(fcols)}")

# Rows the ML never sees: hard-QC rows (fill/oor/stale/missing all) are decided by Tier-1.
hard = (qc["hard"] == 1) | (qc["all_missing"] == 1)
ml_rows = ~hard.values
y = obs["label"].values.astype(np.int8)
# natural archive gaps are genuine missing telemetry -> label them as such (fault="missing") for honest scoring
nat_gap = (qc["all_missing"].values == 1) & (y == 0)
y = np.where(nat_gap, 1, y).astype(np.int8)
obs.loc[nat_gap, "fault"] = "missing"
print(f"natural missing rows relabelled: {int(nat_gap.sum()):,}")
split = obs["split"].astype(str).values

def take(mask):
    idx = np.flatnonzero(mask)
    return np.asarray(X_all[idx][:, fidx], dtype=np.float32), idx

# subsample normal training rows to save memory/time (keep all positives)
rng = np.random.default_rng(0)
tr_mask = (split == "train") & ml_rows
pos = tr_mask & (y == 1)
neg = tr_mask & (y == 0)
neg_idx = np.flatnonzero(neg); keep = rng.choice(neg_idx, size=min(len(neg_idx), 350_000), replace=False)
sel = np.zeros(len(obs), bool); sel[np.flatnonzero(pos)] = True; sel[keep] = True
Xtr, itr = take(sel); ytr = y[itr]
Xva, iva = take((split == "val") & ml_rows); yva = y[iva]
print(f"train {Xtr.shape} pos={ytr.sum():,}  val {Xva.shape} pos={yva.sum():,}  ({time.time()-t0:.0f}s)")

# --------------------------------------------------------------------------- detector
spw = (ytr == 0).sum() / max((ytr == 1).sum(), 1)
det = lgb.LGBMClassifier(objective="binary", n_estimators=1500, learning_rate=0.03, num_leaves=63, min_child_samples=100,
                         subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, scale_pos_weight=min(spw, 8.0),
                         n_jobs=2, verbose=-1, metric="average_precision")
det.fit(Xtr, ytr, eval_set=[(Xva, yva)],
        callbacks=[lgb.early_stopping(150, first_metric_only=True, verbose=False)])
print(f"detector trees={det.best_iteration_} ({time.time()-t0:.0f}s)")
pva = det.predict_proba(Xva)[:, 1]

# threshold: maximise F1 on val subject to FPR <= 0.5 % on genuinely-normal rows
ths = np.linspace(0.05, 0.95, 181)
best = None
for th in ths:
    pred = pva >= th
    p, r, f, _ = precision_recall_fscore_support(yva, pred, average="binary", zero_division=0)
    fpr = ((pred == 1) & (yva == 0)).sum() / max((yva == 0).sum(), 1)
    if fpr <= 0.005 and (best is None or f > best[1]):
        best = (th, f, p, r, fpr)
if best is None:
    cands = [(th,) + precision_recall_fscore_support(yva, pva >= th, average="binary", zero_division=0)[:3] + (0,) for th in ths]
    best = max(cands, key=lambda t: t[1])
theta = float(best[0])
print(f"theta={theta:.3f} val F1={best[1]:.3f} P={best[2]:.3f} R={best[3]:.3f} FPR={best[4]:.4f}")

# --------------------------------------------------------------------------- root-cause classifier (on labelled ML rows)
classes = ["spike", "frozen", "drift", "bias", "noise", "inconsistency"]
cmap = {c: i for i, c in enumerate(classes)}
ftr = obs["fault"].astype(str).values
rc_mask = sel & np.isin(ftr, classes) & (y == 1)
Xrc, irc = take(rc_mask); yrc = np.array([cmap[c] for c in ftr[irc]])
rc = lgb.LGBMClassifier(objective="multiclass", n_estimators=600, learning_rate=0.05, num_leaves=63, min_child_samples=50,
                        subsample=0.8, subsample_freq=1, colsample_bytree=0.7, class_weight="balanced", n_jobs=2, verbose=-1)
rc.fit(Xrc, yrc)
print(f"root-cause trained on {len(yrc):,} rows ({time.time()-t0:.0f}s)")
del Xtr, Xrc

# --------------------------------------------------------------------------- TEST evaluation
te = (split == "test")
Xte, ite = take(te & ml_rows); yte = y[ite]
pte = det.predict_proba(Xte)[:, 1]
pred_ml = pte >= theta
# full test-set decision = Tier-1 hard flags OR ML
pred_full = np.zeros(te.sum(), bool); yfull = y[te]
te_idx = np.flatnonzero(te)
pos_in_te = {v: k for k, v in enumerate(te_idx)}
pred_full[[pos_in_te[i] for i in ite]] = pred_ml
hard_te = hard.values[te]
pred_full |= hard_te
P, R, F, _ = precision_recall_fscore_support(yfull, pred_full, average="binary", zero_division=0)
tn, fp, fn, tp = confusion_matrix(yfull, pred_full).ravel()
auc = roc_auc_score(yte, pte); ap = average_precision_score(yte, pte)
print(f"TEST point-level: P={P:.3f} R={R:.3f} F1={F:.3f} FPR={fp/(fp+tn):.4f} AUC={auc:.3f} AP={ap:.3f} tp={tp} fp={fp} fn={fn} tn={tn}")

# event-level: detected if any alert inside the episode; time-to-detect from episode start
ote = obs.iloc[te_idx].copy(); ote["pred"] = pred_full
ev = ote[ote.event_id > 0].groupby("event_id").agg(fault=("fault", "first"), start=("ts", "min"), n=("ts", "size"),
                                                   det=("pred", "max"), first_det=("ts", lambda s: s[ote.loc[s.index, "pred"].values].min() if ote.loc[s.index, "pred"].any() else pd.NaT))
ev["ttd_h"] = (ev["first_det"] - ev["start"]).dt.total_seconds() / 3600
ev_tab = ev.groupby("fault").agg(events=("det", "size"), detected=("det", "sum"), median_ttd_h=("ttd_h", "median"))
ev_tab["rate"] = ev_tab["detected"] / ev_tab["events"]
print(ev_tab)
event_rate = float(ev["det"].mean())

# per-fault point recall + root-cause accuracy given detection
per_fault = {}
rc_pred = rc.predict(Xte)
ftest = ftr[ite]
for c in classes + ["missing", "fill", "stale"]:
    m = (obs["fault"].astype(str).values[te] == c) & (yfull == 1)
    per_fault[c] = {"rows": int(m.sum()), "recall": float(pred_full[m].mean()) if m.sum() else None}
m = np.isin(ftest, classes) & pred_ml
rc_acc = float((np.array([classes[i] for i in rc_pred[m]]) == ftest[m]).mean())
rc_cm = pd.crosstab(pd.Series(ftest[m], name="true"), pd.Series(np.array([classes[i] for i in rc_pred[m]]), name="pred"))
print(f"root-cause accuracy given detection: {rc_acc:.3f}\n{rc_cm}")
print("per-fault point recall:", {k: (None if v["recall"] is None else round(v["recall"], 3)) for k, v in per_fault.items()})
fp_hard = int((hard_te & (yfull == 0)).sum()); print(f"FP from hard flags: {fp_hard}  FP from ML: {int(fp - fp_hard)}")
ote["fp"] = pred_full & (yfull == 0)
print("FP by month:", ote.groupby(ote.ts.dt.month)["fp"].mean().round(4).to_dict())
print("FP by station (top 8):", ote.groupby("station_id", observed=True)["fp"].mean().sort_values(ascending=False).head(8).round(3).to_dict())
qte = qc.iloc[te_idx]
for c in ("td_gt_t", "stale", "any_fill", "any_oor", "duplicate_ts"):
    print(f"  hard flag {c}: fires on {int(qte[c].sum())} test rows, of which unlabelled {int(((qte[c]==1).values & (yfull==0)).sum())}")

# genuine-weather false alarm rate (real extreme hours where neighbours agree)
gen = ote["genuine_event"].values == 1
gen_fa = float(pred_full[gen].mean()) if gen.sum() else None
norm_fa = float(pred_full[(yfull == 0) & ~gen].mean())
print(f"false-alarm rate on genuine extreme-weather hours: {gen_fa:.4f} (n={gen.sum():,}) vs ordinary normal hours {norm_fa:.4f}")

# feature importance top 20
imp = pd.Series(det.booster_.feature_importance("gain"), index=fcols).sort_values(ascending=False)
print(imp.head(20).round(0))

metrics = {
    "test_rows": int(te.sum()), "test_positive_rows": int(yfull.sum()),
    "point": {"precision": P, "recall": R, "f1": F, "fpr": float(fp / (fp + tn)), "auc": float(auc), "ap": float(ap),
              "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)},
    "event_detection_rate": event_rate,
    "event_by_fault": {k: {"events": int(v.events), "detected": int(v.detected), "rate": float(v.rate),
                           "median_ttd_h": (None if pd.isna(v.median_ttd_h) else float(v.median_ttd_h))} for k, v in ev_tab.iterrows()},
    "per_fault_point_recall": per_fault,
    "root_cause_accuracy_given_detection": rc_acc,
    "root_cause_confusion": {str(k): {str(kk): int(vv) for kk, vv in row.items()} for k, row in rc_cm.to_dict(orient="index").items()},
    "genuine_weather_false_alarm_rate": gen_fa, "genuine_weather_hours": int(gen.sum()), "normal_false_alarm_rate": norm_fa,
    "theta": theta, "detector_trees": int(det.best_iteration_), "n_features": len(fcols),
    "train_period": f"2023-01-01..{ctx['train_end'][:10]}", "val_period": f"{ctx['train_end'][:10]}..{ctx['val_end'][:10]}",
    "test_period": f"{ctx['val_end'][:10]}..2025-06-13", "stations": int(obs['station_id'].nunique()),
    "top_features": {k: float(v) for k, v in imp.head(25).items()},
}
json.dump(metrics, open(ROOT / "models" / "metrics.json", "w", encoding="utf-8"), indent=2, default=float)
joblib.dump({"detector": det.booster_, "root_cause": rc.booster_, "classes": classes, "theta": theta, "feature_cols": fcols},
            ROOT / "models" / "skyguard_models.joblib", compress=3)
print(f"saved. total {time.time()-t0:.0f}s")
