"""Tier-1 deterministic QC (WMO-TD-1236 level 1 & 2, MADIS level 1). Pure rules, no ML.
Returns hard flags that short-circuit the ML: out_of_range, fill, missing, stale, duplicate, td_gt_t."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import FILL_VALUES, RESOLUTION, SENSORS, WMO_LIMITS
from .physics import dew_point


def integer_resolution(df: pd.DataFrame) -> dict[str, dict[str, bool]]:
    """Per station: does the logger report temperature / pressure at whole-number resolution
    (>= 50 % of values are integers)?  Such stations naturally repeat identical values for many
    hours, so persistence tests (stale / frozen) need a longer run before they are trustworthy."""
    out: dict[str, dict[str, bool]] = {}
    for sid, g in df.groupby("station_id"):
        d = {}
        for s in ("temp", "pres"):
            x = g[s].dropna().values
            d[s] = bool(len(x) >= 24 and (np.abs(x - np.round(x)) < 1e-6).mean() >= 0.5)
        d["rh"] = False  # RH is reported as whole percent everywhere - already the assumed resolution
        out[str(sid)] = d
    return out


def tier1(df: pd.DataFrame) -> pd.DataFrame:
    """df: [station_id, ts, temp, pres, rh] sorted per station. Returns flags frame (same index)."""
    out = pd.DataFrame(index=df.index)
    for s in SENSORS:
        x = df[s]
        lo, hi = WMO_LIMITS[s]
        # a sentinel must also be physically implausible for THIS sensor: 999.9 is a real pressure (hPa)
        out[f"{s}_fill"] = x.isin(FILL_VALUES) & ~x.between(lo, hi)
        out[f"{s}_oor"] = (~out[f"{s}_fill"]) & x.notna() & ((x < lo) | (x > hi))
        out[f"{s}_missing"] = x.isna()
    # RH exactly 0 is physically implausible in India -> treat as fill; pressure exactly 0 is a logger placeholder
    out["rh_fill"] |= df["rh"].eq(0.0)
    out["pres_fill"] |= df["pres"].eq(0.0)
    out["pres_oor"] &= ~out["pres_fill"]
    td = dew_point(df["temp"].values, df["rh"].values)
    out["td_gt_t"] = pd.Series(td > df["temp"].values + 0.5, index=df.index).fillna(False)
    # stale: all three sensors unchanged for >= 3 consecutive reports (logger repeat) - per station
    same = pd.Series(True, index=df.index)
    for s in SENSORS:
        same &= df.groupby("station_id")[s].diff().abs().le(RESOLUTION[s] / 2).fillna(False)
    run = same.groupby(df["station_id"]).transform(lambda v: v.groupby((~v).cumsum()).cumsum())
    # current + 3 previous reports identical on all sensors; stations that log whole numbers repeat
    # identical T/P/RH naturally, so require one more report there (validated: precision 56 % -> 82 %)
    coarse = integer_resolution(df)
    min_run = df["station_id"].astype(str).map(lambda k: 4 if (coarse.get(k, {}).get("temp") or coarse.get(k, {}).get("pres")) else 3)
    out["stale"] = run >= min_run
    out["duplicate_ts"] = df.duplicated(subset=["station_id", "ts"], keep="first")
    out["any_missing"] = out[[f"{s}_missing" for s in SENSORS]].any(axis=1)
    out["all_missing"] = out[[f"{s}_missing" for s in SENSORS]].all(axis=1)
    out["any_fill"] = out[[f"{s}_fill" for s in SENSORS]].any(axis=1)
    out["any_oor"] = out[[f"{s}_oor" for s in SENSORS]].any(axis=1)
    out["hard"] = out["any_fill"] | out["any_oor"] | out["stale"] | out["duplicate_ts"] | out["td_gt_t"]
    return out


def clean_for_features(df: pd.DataFrame, flags: pd.DataFrame) -> pd.DataFrame:
    """Replace fill / out-of-range values with NaN so they do not poison rolling statistics."""
    df = df.copy()
    for s in SENSORS:
        df.loc[flags[f"{s}_fill"] | flags[f"{s}_oor"], s] = np.nan
    return df
