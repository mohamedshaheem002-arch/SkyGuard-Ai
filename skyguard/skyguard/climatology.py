"""Robust station climatology: median / MAD per (station, month, hour) with pooling & fallbacks.

Also learns per-station natural variability statistics used by the WMO "minimum/maximum
variability" tests (typical hourly step scale, 99th-percentile natural persistence streak).
Everything is robust (median/MAD/quantiles) so it can be fitted on data that already contains
a few percent of faults - which is what happens in judge mode (fitted on the uploaded file).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import RESOLUTION, SENSORS
from .physics import dew_point

CLIM_SENSORS = ("temp", "pres", "rh", "td")
MAD_K = 1.4826
MIN_BIN = 12


def _streaks(x: np.ndarray, ts: np.ndarray, res: float) -> np.ndarray:
    """Hours since the value last changed by more than res/2 (NaN where x is NaN)."""
    n = len(x)
    out = np.full(n, np.nan)
    last_change_ts = None
    last_val = None
    for i in range(n):
        v = x[i]
        if np.isnan(v):
            continue
        if last_val is None or abs(v - last_val) > res / 2:
            last_change_ts = ts[i]
            last_val = v
        out[i] = (ts[i] - last_change_ts) / np.timedelta64(1, "h")
    return out


class Climatology:
    def __init__(self):
        self.tables: dict[str, dict] = {}   # station -> {sensor: {"med": (12,24) array, "mad": (12,24)}}
        self.step_scale: dict[str, dict] = {}
        self.streak_p99: dict[str, dict] = {}
        self.global_med: dict[str, float] = {}
        self.global_mad: dict[str, float] = {}
        self.n_hours: dict[str, int] = {}

    # ---------------------------------------------------------------- fitting
    def fit(self, df: pd.DataFrame) -> "Climatology":
        df = df.copy()
        df["td"] = dew_point(df["temp"].values, df["rh"].values)
        df["month"] = df["ts"].dt.month.values
        df["hour"] = df["ts"].dt.hour.values
        for sen in CLIM_SENSORS:
            v = df[sen].dropna()
            self.global_med[sen] = float(v.median()) if len(v) else np.nan
            self.global_mad[sen] = float(MAD_K * (v - v.median()).abs().median()) if len(v) else np.nan
        for sid, g in df.groupby("station_id", sort=False):
            self.n_hours[sid] = int(len(g))
            self.tables[sid] = {}
            self.step_scale[sid] = {}
            self.streak_p99[sid] = {}
            g = g.sort_values("ts")
            ts = g["ts"].values
            for sen in CLIM_SENSORS:
                self.tables[sid][sen] = self._fit_table(g, sen)
                x = g[sen].values.astype(float)
                d = np.abs(np.diff(x))
                d = d[np.isfinite(d)]
                # robust scale of hourly changes (MAD of |dx| ~ typical step)
                self.step_scale[sid][sen] = float(max(MAD_K * np.median(d), 1e-3)) if len(d) > 50 else np.nan
                if sen in RESOLUTION:
                    st = _streaks(x, ts, RESOLUTION[sen])
                    st = st[np.isfinite(st)]
                    self.streak_p99[sid][sen] = float(np.quantile(st, 0.99)) if len(st) > 200 else np.nan
        return self

    def _fit_table(self, g: pd.DataFrame, sen: str):
        med = np.full((12, 24), np.nan)
        mad = np.full((12, 24), np.nan)
        cnt = np.zeros((12, 24), dtype=int)
        grp = g.groupby(["month", "hour"])[sen]
        agg_med = grp.median()
        agg_cnt = grp.count()
        for (m, h), val in agg_med.items():
            med[m - 1, h] = val
            cnt[m - 1, h] = agg_cnt[(m, h)]
        # pooled MAD from residuals to the (month,hour) median, computed with +-1 month pooling
        resid = g[sen].values - med[g["month"].values - 1, g["hour"].values]
        r = pd.DataFrame({"month": g["month"].values, "hour": g["hour"].values, "r": np.abs(resid)}).dropna()
        for m in range(1, 13):
            months = [(m - 2) % 12 + 1, m, m % 12 + 1]
            sub = r[r["month"].isin(months)]
            if len(sub) == 0:
                continue
            hm = sub.groupby("hour")["r"].median()
            for h, val in hm.items():
                mad[m - 1, h] = MAD_K * val
        # fill sparse / empty median bins by pooling neighbouring months, then hour-only, then global
        hour_only = g.groupby("hour")[sen].median()
        for m in range(12):
            for h in range(24):
                if cnt[m, h] < MIN_BIN:
                    pool = [med[(m - 1) % 12, h], med[m, h], med[(m + 1) % 12, h]]
                    pool = [p for p in pool if np.isfinite(p)]
                    med[m, h] = np.mean(pool) if pool else hour_only.get(h, np.nan)
                if not np.isfinite(med[m, h]):
                    med[m, h] = hour_only.get(h, np.nan)
                if not np.isfinite(mad[m, h]):
                    mad[m, h] = np.nanmedian(mad) if np.isfinite(np.nanmedian(mad)) else np.nan
        # floor on MAD so z-scores stay finite in very stable climates
        floor = {"temp": 0.4, "pres": 0.4, "rh": 2.0, "td": 0.5}[sen]
        mad = np.where(np.isfinite(mad), np.maximum(mad, floor), np.nan)
        return {"med": med, "mad": mad, "n": cnt}

    # ---------------------------------------------------------------- lookup
    def has(self, sid: str) -> bool:
        return sid in self.tables

    def lookup(self, sid: str, sen: str, month: np.ndarray, hour: np.ndarray):
        """Return (median, mad) arrays for the given month/hour arrays. Global fallback if unknown station."""
        t = self.tables.get(sid, {}).get(sen)
        month = np.asarray(month, dtype=int) - 1
        hour = np.asarray(hour, dtype=int)
        if t is None:
            n = len(month)
            return np.full(n, self.global_med.get(sen, np.nan)), np.full(n, self.global_mad.get(sen, np.nan))
        return t["med"][month, hour], t["mad"][month, hour]

    def step_sigma(self, sid: str, sen: str) -> float:
        v = self.step_scale.get(sid, {}).get(sen)
        if v is None or not np.isfinite(v):
            # network-wide fallback
            vals = [d[sen] for d in self.step_scale.values() if np.isfinite(d.get(sen, np.nan))]
            v = float(np.median(vals)) if vals else {"temp": 0.6, "pres": 0.5, "rh": 4.0, "td": 0.6}[sen]
        return v

    def streak_ref(self, sid: str, sen: str) -> float:
        v = self.streak_p99.get(sid, {}).get(sen)
        if v is None or not np.isfinite(v):
            vals = [d[sen] for d in self.streak_p99.values() if np.isfinite(d.get(sen, np.nan))]
            v = float(np.median(vals)) if vals else {"temp": 4.0, "pres": 3.0, "rh": 8.0}[sen]
        return max(v, 1.0)

    def describe(self, sid: str) -> dict:
        return {
            "known": sid in self.tables,
            "hours": self.n_hours.get(sid),
            "step_sigma": {s: self.step_sigma(sid, s) for s in SENSORS},
            "streak_p99": {s: self.streak_ref(sid, s) for s in SENSORS},
        }
