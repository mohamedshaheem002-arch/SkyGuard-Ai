"""Feature engineering (~80 features/row): climatological, temporal, spatial, physical, integrity.

Design references
* WMO-TD No.1236 (Guidelines on QC of surface climatological data): plausible value, temporal
  consistency (step), internal consistency (Td <= T), persistence (minimum variability) tests.
* NOAA MADIS QC: level-1 validity, level-2 temporal & internal consistency, level-3 spatial (SRT).
* MET Norway TITAN: buddy / spatial regression checks with elevation-aware neighbours.
* Page (1954) CUSUM & EWMA control charts for drift and bias (calibration) detection.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .climatology import Climatology, _streaks
from .config import RESOLUTION, SENSORS, TOLERANCE, WMO_LIMITS
from .physics import dew_point
from .spatial import SpatialModel

ALL_SENSORS = ("temp", "pres", "rh", "td")


def _cusum(z: np.ndarray, k: float = 0.5, cap: float = 30.0):
    pos = np.zeros(len(z)); neg = np.zeros(len(z))
    sp = sn = 0.0
    for i in range(len(z)):
        v = z[i]
        if np.isnan(v):
            sp *= 0.9; sn *= 0.9          # decay through gaps
        else:
            sp = min(max(0.0, sp + v - k), cap)
            sn = min(max(0.0, sn - v - k), cap)
        pos[i] = sp; neg[i] = sn
    return pos, neg


def _rolling_slope(x: np.ndarray, n: int) -> np.ndarray:
    """Slope (units per step) of a least-squares line over the trailing n samples. NaN-tolerant via ffill."""
    s = pd.Series(x).ffill(limit=n).values
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    t = np.arange(n) - (n - 1) / 2.0
    denom = (t ** 2).sum()
    w = t[::-1] / denom                      # convolution kernel
    valid = np.isfinite(s)
    s0 = np.where(valid, s, 0.0)
    num = np.convolve(s0, w, mode="valid")
    cnt = np.convolve(valid.astype(float), np.ones(n), mode="valid")
    res = np.where(cnt >= n * 0.8, num, np.nan)
    out[n - 1:] = res
    return out


def _hours_since_valid(valid: np.ndarray, cadence_h: float) -> np.ndarray:
    out = np.zeros(len(valid)); last = -1
    for i in range(len(valid)):
        if valid[i]:
            last = i; out[i] = 0.0
        else:
            out[i] = (i - last) * cadence_h if last >= 0 else np.nan
    return out


def compute_features(df: pd.DataFrame, clim: Climatology, spatial: SpatialModel | None,
                     cadence_h: float = 1.0) -> pd.DataFrame:
    """df: [station_id, ts, temp, pres, rh] on a regular grid per station, sorted by station then ts.
    Returns a float32 feature frame aligned to df.index (plus helper columns prefixed with '_')."""
    df = df.copy()
    df["td"] = dew_point(df["temp"].values, df["rh"].values)
    sph = max(int(round(1.0 / cadence_h)), 1)          # steps per hour
    W6, W12, W24, W72 = 6 * sph, 12 * sph, 24 * sph, 72 * sph
    month = df["ts"].dt.month.values; hour = df["ts"].dt.hour.values
    F = {}
    F["hour_sin"] = np.sin(2 * np.pi * hour / 24); F["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    F["month_sin"] = np.sin(2 * np.pi * month / 12); F["month_cos"] = np.cos(2 * np.pi * month / 12)

    # ---------------- per-station temporal / climatological features
    per_station = []
    for sid, g in df.groupby("station_id", sort=False):
        idx = g.index
        m_ = month[idx.values] if False else g["ts"].dt.month.values
        h_ = g["ts"].dt.hour.values
        ts = g["ts"].values
        out = {}
        cz_store = {}
        for sen in ALL_SENSORS:
            x = g[sen].values.astype(float)
            med, mad = clim.lookup(sid, sen, m_, h_)
            cz = (x - med) / mad
            cz_store[sen] = cz
            ss = clim.step_sigma(sid, sen)
            step = np.diff(x, prepend=np.nan) / ss
            out[f"{sen}_cz"] = cz
            out[f"{sen}_clim_med"] = med
            out[f"{sen}_step_z"] = step
            out[f"{sen}_step_prev_z"] = np.roll(step, 1); out[f"{sen}_step_prev_z"][0] = np.nan
            out[f"{sen}_acc_z"] = step - out[f"{sen}_step_prev_z"]
            xs = pd.Series(x)
            out[f"{sen}_std6_r"] = xs.rolling(W6, min_periods=3).std().values / ss
            out[f"{sen}_rng24_r"] = (xs.rolling(W24, min_periods=6).max() - xs.rolling(W24, min_periods=6).min()).values / mad
            d = pd.Series(np.diff(x, prepend=np.nan))
            out[f"{sen}_dstd6_r"] = d.rolling(W6, min_periods=3).std().values / ss
            czs = pd.Series(cz)
            out[f"{sen}_ewm24_cz"] = czs.ewm(halflife=W12, min_periods=3, ignore_na=True).mean().values
            out[f"{sen}_ewm72_cz"] = czs.ewm(halflife=W72 // 2, min_periods=6, ignore_na=True).mean().values
            out[f"{sen}_slope72_cz"] = _rolling_slope(cz, W72) * 24 * sph      # z-units per day
            cp, cn = _cusum(cz, k=0.5)
            out[f"{sen}_cusum_pos"] = cp; out[f"{sen}_cusum_neg"] = cn
            if sen in RESOLUTION:
                st = _streaks(x, ts, RESOLUTION[sen])
                out[f"{sen}_streak_h"] = st
                out[f"{sen}_streak_r"] = st / clim.streak_ref(sid, sen)
                valid = np.isfinite(x)
                out[f"{sen}_missing"] = (~valid).astype(float)
                out[f"{sen}_gap_h"] = _hours_since_valid(valid, cadence_h)
                lo, hi = WMO_LIMITS[sen]
                out[f"{sen}_oor"] = ((x < lo) | (x > hi)).astype(float)
        # physics
        t = g["temp"].values.astype(float); rh = g["rh"].values.astype(float); p = g["pres"].values.astype(float)
        td = g["td"].values.astype(float)
        out["td_minus_t"] = td - t
        out["rh_t_corr12"] = pd.Series(t).rolling(W12, min_periods=6).corr(pd.Series(rh)).values
        out["p_t_corr12"] = pd.Series(t).rolling(W12, min_periods=6).corr(pd.Series(p)).values
        out["td_t_stdratio6"] = (pd.Series(td).rolling(W6, min_periods=3).std() / (pd.Series(t).rolling(W6, min_periods=3).std() + 0.05)).values
        t_rng6 = (pd.Series(t).rolling(W6, min_periods=3).max() - pd.Series(t).rolling(W6, min_periods=3).min()).values
        out["rh_stuck_t_moving"] = np.nan_to_num(out["rh_streak_h"]) * np.nan_to_num(t_rng6) / 10.0
        out["t_stuck_rh_moving"] = np.nan_to_num(out["temp_streak_h"]) * np.nan_to_num(
            (pd.Series(rh).rolling(W6, min_periods=3).max() - pd.Series(rh).rolling(W6, min_periods=3).min()).values) / 20.0
        out["pres_tend3"] = p - np.roll(p, 3 * sph); out["pres_tend3"][: 3 * sph] = np.nan
        out["pres_tend3_z"] = out["pres_tend3"] / (clim.step_sigma(sid, "pres") * np.sqrt(3))
        with np.errstate(all="ignore"):
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                out["all_streak_min_h"] = np.nanmin(np.vstack([out["temp_streak_h"], out["pres_streak_h"], out["rh_streak_h"]]), axis=0)
        out["n_missing"] = out["temp_missing"] + out["pres_missing"] + out["rh_missing"]
        per_station.append(pd.DataFrame(out, index=idx).astype(np.float32))
        del out
    T = pd.concat(per_station)
    del per_station
    T = T.loc[df.index]
    for k, v in F.items():
        T[k] = v

    # ---------------- spatial features
    if spatial is not None:
        clim_z = {s: T[f"{s}_cz"] for s in SENSORS}
        S = spatial.transform(df, clim_z=clim_z)
        sid_all = df["station_id"].values
        groups = [np.flatnonzero(sid_all == s) for s in pd.unique(sid_all)]
        for sen in SENSORS:
            rz = S[f"sp_z_{sen}"].values
            resid = (df[sen].values - S[f"sp_est_{sen}"].values).astype(np.float32)
            ewm = np.full(len(df), np.nan, np.float32); slope = ewm.copy(); bias24 = ewm.copy()
            scp = np.zeros(len(df), np.float32); scn = scp.copy()
            for ix in groups:
                ewm[ix] = pd.Series(rz[ix]).ewm(halflife=W12, min_periods=3, ignore_na=True).mean().values
                slope[ix] = _rolling_slope(rz[ix], W72) * 24 * sph
                bias24[ix] = pd.Series(resid[ix]).rolling(W24, min_periods=6).median().values
                cp_, cn_ = _cusum(rz[ix].astype(float), k=0.75, cap=40.0); scp[ix] = cp_; scn[ix] = cn_
            T[f"{sen}_sp_cusum_pos"] = scp; T[f"{sen}_sp_cusum_neg"] = scn
            T[f"{sen}_sp_z"] = rz; T[f"{sen}_sp_n"] = S[f"sp_n_{sen}"].values
            T[f"{sen}_witness"] = S[f"witness_{sen}"].values; T[f"{sen}_nb_med_z"] = S[f"nb_med_z_{sen}"].values
            T[f"{sen}_sp_est"] = S[f"sp_est_{sen}"].values
            T[f"{sen}_sp_ewm24_z"] = ewm; T[f"{sen}_sp_slope72_z"] = slope; T[f"{sen}_sp_bias_med24"] = bias24
            T[f"{sen}_cz_minus_nb"] = T[f"{sen}_cz"].values - np.nan_to_num(T[f"{sen}_nb_med_z"].values)
        pest = S["sp_est_pres"].values
        tend_nb = np.full(len(df), np.nan, np.float32)
        for ix in groups:
            v = pest[ix]; t = np.full(len(ix), np.nan, np.float32); t[3 * sph:] = v[3 * sph:] - v[:-3 * sph]; tend_nb[ix] = t
        T["pres_tend3_minus_nb"] = T["pres_tend3"].values - tend_nb
        del S
    else:
        for sen in SENSORS:
            for suffix in ("sp_z", "witness", "nb_med_z", "sp_ewm24_z", "sp_slope72_z", "sp_bias_med24", "sp_est"):
                T[f"{sen}_{suffix}"] = np.nan
            T[f"{sen}_sp_cusum_pos"] = 0.0; T[f"{sen}_sp_cusum_neg"] = 0.0
            T[f"{sen}_sp_n"] = 0.0
            T[f"{sen}_cz_minus_nb"] = T[f"{sen}_cz"]
        T["pres_tend3_minus_nb"] = np.nan
    return T.astype(np.float32, copy=False)


# Columns used by the model (exclude helper columns which are kept for explanations / corrections)
HELPER_COLS = {f"{s}_clim_med" for s in ALL_SENSORS} | {f"{s}_sp_est" for s in SENSORS} | {f"{s}_sp_bias_med24" for s in SENSORS} | {"pres_tend3"}


def model_columns(T: pd.DataFrame) -> list[str]:
    return [c for c in T.columns if c not in HELPER_COLS]


def sensor_of_feature(col: str) -> str | None:
    for s in ("temp", "pres", "rh", "td"):
        if col.startswith(s + "_"):
            return "rh" if s == "td" else s
    if col.startswith("td_") or col in ("rh_t_corr12", "rh_stuck_t_moving", "td_t_stdratio6"):
        return "rh"
    if col.startswith("p_t_corr") or col.startswith("pres_tend"):
        return "pres"
    if col.startswith("t_stuck"):
        return "temp"
    return None
