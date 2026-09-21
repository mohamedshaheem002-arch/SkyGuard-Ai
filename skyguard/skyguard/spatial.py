"""Spatial consistency: Hubbard-style Spatial Regression Test (SRT) + witness agreement.

Reference: Hubbard, Goddard, Sorensen, Wells & Osugi (2005), "Performance of Quality Assurance
Procedures for an Applied Climate Information System", J. Atmos. Ocean. Tech. - the SRT is the
spatial check used by the US High Plains Regional Climate Center / ACIS and inspired the MADIS
spatial consistency check.  For each station s and each neighbour j we fit a robust linear map
x_s ~ a_j + b_j * x_j (this absorbs elevation / coastal offsets) and record the residual scale
sigma_j.  The spatial estimate is the inverse-variance weighted mean of the neighbour predictions
and the test statistic is  z_sp = (x_s - x_hat) / s',   s' = sqrt(N / sum(1/sigma_j^2)).

Witness agreement: fraction of neighbours whose OWN climatological anomaly has the same sign and
|z| > 2.  High agreement => the whole area is anomalous => genuine weather, not a sensor fault.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import MAX_NEIGHBOUR_KM, MAX_NEIGHBOURS, MIN_PAIR_SAMPLES, SENSORS
from .physics import haversine_km


def _robust_linfit(x: np.ndarray, y: np.ndarray):
    """OLS with two rounds of 3-sigma residual trimming. Returns a, b, sigma, n."""
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    if len(x) < MIN_PAIR_SAMPLES:
        return np.nan, np.nan, np.nan, len(x)
    for _ in range(3):
        b, a = np.polyfit(x, y, 1)
        r = y - (a + b * x)
        s = 1.4826 * np.median(np.abs(r - np.median(r))) + 1e-6
        keep = np.abs(r) < 3.5 * s
        if keep.sum() < MIN_PAIR_SAMPLES or keep.all():
            break
        x, y = x[keep], y[keep]
    b, a = np.polyfit(x, y, 1)
    r = y - (a + b * x)
    sigma = float(max(np.std(r), 1e-3))
    return float(a), float(b), sigma, int(len(x))


class SpatialModel:
    def __init__(self, max_neighbours=MAX_NEIGHBOURS, max_km=MAX_NEIGHBOUR_KM):
        self.max_neighbours = max_neighbours
        self.max_km = max_km
        self.meta: pd.DataFrame | None = None
        self.neighbours: dict[str, list[tuple[str, float]]] = {}
        self.pairs: dict[tuple[str, str, str], tuple[float, float, float]] = {}  # (s, j, sensor) -> (a, b, sigma)
        self.resid_scale: dict[tuple[str, str], float] = {}  # (s, sensor) -> robust std of (x - x_hat) on training data
        self.RESID_FLOOR = {"temp": 0.35, "pres": 0.35, "rh": 2.5}

    # ------------------------------------------------------------------ fit
    def fit(self, df: pd.DataFrame, meta: pd.DataFrame) -> "SpatialModel":
        """df: long format [station_id, ts, temp, pres, rh] (training period). meta: index station_id, lat, lon."""
        self.meta = meta.copy()
        ids = [s for s in meta.index if s in set(df["station_id"].unique())]
        lat = meta.loc[ids, "lat"].values.astype(float)
        lon = meta.loc[ids, "lon"].values.astype(float)
        wide = {sen: df.pivot_table(index="ts", columns="station_id", values=sen, aggfunc="first") for sen in SENSORS}
        for i, s in enumerate(ids):
            d = haversine_km(lat[i], lon[i], lat, lon)
            order = np.argsort(d)
            nb = [(ids[j], float(d[j])) for j in order if ids[j] != s and d[j] <= self.max_km][: self.max_neighbours]
            self.neighbours[s] = nb
            for j, _ in nb:
                for sen in SENSORS:
                    if s in wide[sen] and j in wide[sen]:
                        a, b, sig, n = _robust_linfit(wide[sen][j].values, wide[sen][s].values)
                        if np.isfinite(sig):
                            self.pairs[(s, j, sen)] = (a, b, sig)
        # calibrate the combined-estimate residual scale on the training data itself
        tmp = self.transform(df)
        for s in ids:
            m = (df["station_id"].values == s)
            for sen in SENSORS:
                r = (df[sen].values[m] - tmp[f"sp_est_{sen}"].values[m])
                r = r[np.isfinite(r)]
                if len(r) > MIN_PAIR_SAMPLES:
                    self.resid_scale[(s, sen)] = float(max(1.4826 * np.median(np.abs(r - np.median(r))), self.RESID_FLOOR[sen]))
        return self

    def add_station(self, sid: str, lat: float, lon: float, elev: float = 0.0):
        """Register an unseen station at runtime (cold start): neighbours by distance, identity mapping
        with a conservative sigma so the spatial test still works (down-weighted)."""
        if self.meta is None:
            self.meta = pd.DataFrame(columns=["lat", "lon", "elev"])
        self.meta.loc[sid] = {"lat": lat, "lon": lon, "elev": elev}
        others = [s for s in self.meta.index if s != sid]
        if not others:
            self.neighbours[sid] = []
            return
        d = haversine_km(lat, lon, self.meta.loc[others, "lat"].values.astype(float), self.meta.loc[others, "lon"].values.astype(float))
        order = np.argsort(d)
        nb = [(others[j], float(d[j])) for j in order if d[j] <= self.max_km][: self.max_neighbours]
        self.neighbours[sid] = nb
        for j, dist in nb:
            elev_j = float(self.meta.loc[j, "elev"]) if "elev" in self.meta else 0.0
            for sen in SENSORS:
                offset = 0.0
                if sen == "temp":
                    offset = -0.0065 * (elev - elev_j)      # lapse-rate prior
                elif sen == "pres":
                    offset = -0.12 * (elev - elev_j)        # ~12 hPa per 100 m near surface
                sig = {"temp": 1.5, "pres": 1.5, "rh": 8.0}[sen] * (1 + dist / 150.0)
                self.pairs[(sid, j, sen)] = (offset, 1.0, sig)

    # ------------------------------------------------------------------ apply (batch)
    def transform(self, df: pd.DataFrame, clim_z: dict[str, pd.Series] | None = None) -> pd.DataFrame:
        """Memory-lean, one sensor at a time. Returns per sensor: sp_est, sp_z, sp_n, witness, nb_med_z."""
        out = {}
        ts_all = df["ts"].values
        sid_all = df["station_id"].values
        # positions of each station's rows and a per-station time index
        groups = {s: np.flatnonzero(sid_all == s) for s in pd.unique(sid_all)}
        for sen in SENSORS:
            x_all = df[sen].values.astype(np.float32)
            # per-station Series for fast reindexing
            series = {s: pd.Series(x_all[ix], index=ts_all[ix]) for s, ix in groups.items()}
            zser = None
            if clim_z is not None:
                zc = clim_z[sen].values.astype(np.float32)
                zser = {s: pd.Series(zc[ix], index=ts_all[ix]) for s, ix in groups.items()}
            est = np.full(len(df), np.nan, dtype=np.float32); z = est.copy(); wit = est.copy(); nbz = est.copy()
            nn = np.zeros(len(df), dtype=np.int8)
            for s, ix in groups.items():
                nb = self.neighbours.get(s, [])
                if not nb:
                    continue
                ts = ts_all[ix]
                num = np.zeros(len(ix), dtype=np.float64); den = np.zeros(len(ix), dtype=np.float64); cnt = np.zeros(len(ix), dtype=np.int8)
                zs = []
                for j, _ in nb:
                    p = self.pairs.get((s, j, sen))
                    if p is None or j not in series:
                        continue
                    a, b, sig = p
                    xj = series[j].reindex(ts).values
                    ok = np.isfinite(xj)
                    w = 1.0 / sig ** 2
                    num[ok] += w * (a + b * xj[ok]); den[ok] += w; cnt[ok] += 1
                    if zser is not None and j in zser:
                        zs.append(zser[j].reindex(ts).values)
                with np.errstate(invalid="ignore", divide="ignore"):
                    xhat = np.where(den > 0, num / den, np.nan)
                    sprime = np.where(den > 0, np.sqrt(cnt / np.where(den > 0, den, 1)), np.nan)
                    scale = self.resid_scale.get((s, sen))
                    if scale is None:
                        scale = sprime
                    est[ix] = xhat; z[ix] = (x_all[ix] - xhat) / scale; nn[ix] = cnt
                if zs:
                    Z = np.vstack(zs)
                    own = zser[s].values
                    with np.errstate(invalid="ignore"):
                        same = (np.sign(Z) == np.sign(own)[None, :]) & (np.abs(Z) > 2.0)
                        avail = np.isfinite(Z)
                        na = avail.sum(0)
                        wit[ix] = np.where(na > 0, same.sum(0) / np.maximum(na, 1), np.nan)
                        import warnings
                        with warnings.catch_warnings():
                            warnings.simplefilter("ignore")
                            nbz[ix] = np.nanmedian(Z, axis=0)
                    del Z
            out[f"sp_est_{sen}"] = est; out[f"sp_z_{sen}"] = z; out[f"sp_n_{sen}"] = nn
            out[f"witness_{sen}"] = wit; out[f"nb_med_z_{sen}"] = nbz
            del series, zser
        return pd.DataFrame(out, index=df.index)

    # ------------------------------------------------------------------ apply (single reading, streaming)
    def estimate_point(self, sid: str, sen: str, neighbour_values: dict[str, float]):
        """neighbour_values: {neighbour_id: latest value}. Returns (x_hat, s_prime, n)."""
        num = den = 0.0; n = 0
        for j, _ in self.neighbours.get(sid, []):
            p = self.pairs.get((sid, j, sen)); v = neighbour_values.get(j)
            if p is None or v is None or not np.isfinite(v):
                continue
            a, b, sig = p
            w = 1.0 / sig ** 2
            num += w * (a + b * v); den += w; n += 1
        if n == 0:
            return np.nan, np.nan, 0
        scale = self.resid_scale.get((sid, sen), float(np.sqrt(n / den)))
        return num / den, scale, n
