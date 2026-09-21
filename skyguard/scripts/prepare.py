"""Step 1: load network, inject faults, fit climatology+spatial on the training period, build features.
Writes data/dataset.parquet (obs + labels + features) and models/context.joblib (clim + spatial + meta)."""
from __future__ import annotations

import sys, time
from pathlib import Path

import joblib, resource
def rss(tag): print(f"[mem] {tag}: {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024:.0f} MB peak")
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from skyguard.data import load_network, load_station_meta
from skyguard.inject import inject, summary
from skyguard.qc import tier1, clean_for_features
from skyguard.climatology import Climatology
from skyguard.spatial import SpatialModel
from skyguard.features import compute_features, model_columns

TRAIN_END = pd.Timestamp("2024-09-01")   # climatology / spatial / detector fitted before this
VAL_END = pd.Timestamp("2025-01-01")     # thresholds chosen here; test = 2024-12-01 .. 2025-06-14

t0 = time.time()
meta = load_station_meta()
print(f"stations: {len(meta)}")
raw = load_network(start="2023-01-01")
print(f"raw rows: {len(raw):,}  span {raw.ts.min()} -> {raw.ts.max()}  ({time.time()-t0:.0f}s)")

obs = inject(raw, seed=7)
del raw
print(summary(obs))

flags = tier1(obs)
clean = clean_for_features(obs, flags)

# Fit climatology & spatial on training period using CLEAN TRUE values (what IMD would have from QC'd archive).
train_true = obs[obs.ts < TRAIN_END][["station_id", "ts"]].copy()
for s in ("temp", "pres", "rh"):
    train_true[s] = obs.loc[obs.ts < TRAIN_END, f"true_{s}"].values
clim = Climatology().fit(train_true)
spatial = SpatialModel().fit(train_true, meta)
print(f"climatology + spatial fitted ({time.time()-t0:.0f}s); pairs={len(spatial.pairs)}")

import gc
feats = compute_features(clean[["station_id", "ts", "temp", "pres", "rh"]], clim, spatial, cadence_h=1.0)
del clean; gc.collect()
for c in ("fault", "sensor"):
    obs[c] = obs[c].astype("category")
print(f"features: {feats.shape} ({time.time()-t0:.0f}s)"); rss("after features")

# genuine-weather label: own |clim z| > 2.5 on a real (uninjected) value AND >= 60% neighbours agree
gen = np.zeros(len(obs), dtype=bool)
for s in ("temp", "pres", "rh"):
    cz = feats[f"{s}_cz"].values; wit = feats[f"{s}_witness"].values
    gen |= (np.abs(cz) > 2.5) & (wit >= 0.6) & (obs["label"].values == 0)
obs["genuine_event"] = gen.astype(np.int8); rss("after genuine")
print(f"genuine-weather hours (unlabelled, neighbours agree): {gen.sum():,}")

(ROOT / "data").mkdir(exist_ok=True); (ROOT / "models").mkdir(exist_ok=True)
split = np.where(obs.ts < TRAIN_END, "train", np.where(obs.ts < VAL_END, "val", "test"))
obs["split"] = pd.Categorical(split)
# write in three lean pieces (concat of 109 cols x 0.9M rows does not fit in 2 GB)
for c in ("station_id",):
    obs[c] = obs[c].astype("category")
obs.reset_index(drop=True).to_parquet(ROOT / "data" / "obs.parquet", index=False)
flags.reset_index(drop=True).astype(np.int8).to_parquet(ROOT / "data" / "qc.parquet", index=False); rss("after obs/qc write"); del obs, flags; gc.collect(); rss("after del obs")
fc = model_columns(feats)
cols = list(feats.columns)
rss("before values")
arr = np.lib.format.open_memmap(ROOT / "data" / "features.npy", mode="w+", dtype=np.float32, shape=(len(feats), len(cols)))
for k, c in enumerate(cols):
    arr[:, k] = feats[c].values.astype(np.float32, copy=False)
    feats.drop(columns=[c], inplace=True)
arr.flush(); rss("after values")
del feats; gc.collect()
joblib.dump(cols, ROOT / "data" / "feature_names.joblib")
del arr; gc.collect()
joblib.dump({"clim": clim, "spatial": spatial, "meta": meta, "feature_cols": fc,
             "train_end": str(TRAIN_END), "val_end": str(VAL_END)}, ROOT / "models" / "context.joblib", compress=3)
print(pd.Series(split).value_counts().to_dict())
print(f"done in {time.time()-t0:.0f}s")
