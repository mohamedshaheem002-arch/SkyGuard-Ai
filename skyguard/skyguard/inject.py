"""Fault injector with ground truth. Produces realistic AWS failure modes on top of REAL observations.

Fault classes (ML):   spike, frozen, drift, bias, noise, inconsistency
Comms / integrity (rules): missing, fill, stale
Labels: `label` (1 = observation wrong beyond WMO tolerance), `fault`, `sensor`, `event_id`.
For drift the label switches on only once the injected error exceeds the WMO tolerance, so the
point-level metrics are honest (nobody can detect a 0.05 °C error) while event-level metrics +
time-to-detect capture how early the ramp is caught.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import SENSORS, TOLERANCE

# episodes per station over the whole period (scaled by n_years)
RATES = {"spike": 24, "frozen": 6, "drift": 1.2, "bias": 1.5, "noise": 2.5, "inconsistency": 2,
         "missing": 8, "fill": 6, "stale": 4}
MAG = {  # magnitude ranges per sensor
    "spike": {"temp": (4, 18), "pres": (4, 30), "rh": (20, 55)},
    "drift": {"temp": (2, 7), "pres": (3, 14), "rh": (12, 40)},
    "bias": {"temp": (2.5, 7), "pres": (3, 12), "rh": (10, 30)},
    "noise": {"temp": (1.0, 3.0), "pres": (1.0, 4.0), "rh": (6, 15)},
}
FILLS = (-999.0, 9999.0, 0.0, -99.9)


def inject(df: pd.DataFrame, seed: int = 7, rate_scale: float = 1.0) -> pd.DataFrame:
    """df: [station_id, ts, temp, pres, rh] regular hourly grid per station. Returns copy with faults."""
    rng = np.random.default_rng(seed)
    df = df.sort_values(["station_id", "ts"]).reset_index(drop=True).copy()
    for s in SENSORS:
        df[f"true_{s}"] = df[s]
    n = len(df)
    label = np.zeros(n, dtype=np.int8)
    fault = np.array(["normal"] * n, dtype=object)
    sensor = np.array([""] * n, dtype=object)
    event = np.zeros(n, dtype=np.int32)
    eid = 0
    vals = {s: df[s].values.astype(float) for s in SENSORS}

    for sid, g in df.groupby("station_id", sort=False):
        i0, i1 = g.index[0], g.index[-1] + 1
        L = i1 - i0
        years = L / (24 * 365.25)
        busy = np.zeros(L, dtype=bool)
        busy[: 24 * 14] = True                      # leave first two weeks clean (warm-up)

        def pick(length):
            for _ in range(200):
                st = int(rng.integers(0, L - length - 1))
                if not busy[st: st + length + 6].any():
                    busy[max(0, st - 6): st + length + 6] = True
                    return st
            return None

        def episodes(kind):
            return int(np.round(RATES[kind] * years * rate_scale))

        for kind in ("spike", "frozen", "drift", "bias", "noise", "inconsistency", "missing", "fill", "stale"):
            for _ in range(episodes(kind)):
                sen = "rh" if kind == "inconsistency" else (None if kind in ("missing", "stale") else str(rng.choice(SENSORS)))
                if kind == "spike":
                    length = int(rng.choice([1, 1, 1, 2, 3]))
                elif kind == "frozen":
                    length = int(rng.integers(4, 72))
                elif kind == "drift":
                    length = int(rng.integers(2 * 24, 12 * 24))
                elif kind == "bias":
                    length = int(rng.integers(12, 5 * 24))
                elif kind == "noise":
                    length = int(rng.integers(6, 48))
                elif kind == "inconsistency":
                    length = int(rng.integers(12, 48))
                elif kind == "missing":
                    length = int(rng.choice([1, 2, 3, 6, 12, 24, 48]))
                elif kind == "fill":
                    length = int(rng.integers(1, 6))
                else:  # stale
                    length = int(rng.integers(3, 14))
                st = pick(length)
                if st is None:
                    continue
                a, b = i0 + st, i0 + st + length
                sl = slice(a, b)
                eid += 1
                if kind == "missing":
                    for s in SENSORS:
                        vals[s][sl] = np.nan
                    label[sl] = 1; fault[sl] = "missing"; sensor[sl] = "all"; event[sl] = eid
                    continue
                if kind == "stale":
                    for s in SENSORS:
                        if np.isfinite(vals[s][a - 1]):
                            vals[s][sl] = vals[s][a - 1]
                    label[sl] = 1; fault[sl] = "stale"; sensor[sl] = "all"; event[sl] = eid
                    continue
                x = vals[sen]
                seg = x[sl].copy()
                if not np.isfinite(seg).any():
                    continue
                if kind == "fill":
                    x[sl] = float(rng.choice(FILLS)) if sen != "rh" else float(rng.choice([-999.0, 0.0, 9999.0]))
                    label[sl] = 1
                elif kind == "spike":
                    lo, hi = MAG["spike"][sen]
                    mag = rng.uniform(lo, hi) * rng.choice([-1, 1])
                    if sen == "rh":
                        x[sl] = np.clip(seg + mag, 0, 100)
                    else:
                        x[sl] = seg + mag
                    label[sl] = 1
                elif kind == "frozen":
                    v = seg[np.isfinite(seg)][0]
                    x[sl] = v + (rng.normal(0, 0.03, length).round(1) if rng.random() < 0.3 else 0.0)
                    err = np.abs(x[sl] - seg)
                    label[sl] = (err > TOLERANCE[sen]) | ~np.isfinite(seg)
                    # very short "frozen" at a stable time may never exceed tolerance -> still an event
                    label[a + 3: b] = 1
                elif kind == "drift":
                    lo, hi = MAG["drift"][sen]
                    mag = rng.uniform(lo, hi) * rng.choice([-1, 1])
                    ramp = np.linspace(0, mag, length)
                    x[sl] = np.clip(seg + ramp, 0, 100) if sen == "rh" else seg + ramp
                    label[sl] = np.abs(ramp) > TOLERANCE[sen]
                elif kind == "bias":
                    lo, hi = MAG["bias"][sen]
                    mag = rng.uniform(lo, hi) * rng.choice([-1, 1])
                    x[sl] = np.clip(seg + mag, 0, 100) if sen == "rh" else seg + mag
                    label[sl] = 1
                elif kind == "noise":
                    lo, hi = MAG["noise"][sen]
                    sd = rng.uniform(lo, hi)
                    nz = rng.normal(0, sd, length)
                    x[sl] = np.clip(seg + nz, 0, 100) if sen == "rh" else seg + nz
                    label[sl] = np.abs(nz) > TOLERANCE[sen]
                    label[a: b] = 1
                elif kind == "inconsistency":
                    # RH element reports the value from 12 h earlier -> RH rises WITH temperature
                    shifted = x[a - 12: b - 12].copy()
                    x[sl] = np.where(np.isfinite(shifted), shifted, seg)
                    label[sl] = np.abs(x[sl] - seg) > TOLERANCE[sen]
                    label[a: b] = 1
                fault[sl] = kind; sensor[sl] = sen; event[sl] = eid

    for s in SENSORS:
        df[s] = vals[s]
    df["label"] = label
    df["fault"] = fault
    df["sensor"] = sensor
    df["event_id"] = event
    return df


def summary(df: pd.DataFrame) -> pd.DataFrame:
    t = df.groupby("fault").agg(rows=("label", "size"), labelled=("label", "sum"),
                                events=("event_id", lambda s: s[s > 0].nunique()))
    t.loc["TOTAL"] = [len(df), int(df["label"].sum()), int(df.loc[df.event_id > 0, "event_id"].nunique())]
    return t
