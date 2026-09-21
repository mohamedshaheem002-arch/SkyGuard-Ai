"""SkyGuard engine: score any frame of AWS observations (known or unseen stations) end to end."""
from __future__ import annotations

import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .climatology import Climatology
from .config import SENSORS
from .data import normalise_schema, sentinel_to_nan
from .decision import verdict, health_from_history
from .features import compute_features
from .qc import tier1, clean_for_features, integer_resolution
from .spatial import SpatialModel

ROOT = Path(__file__).resolve().parents[1]


class SkyGuard:
    def __init__(self, models_dir: Path | str = ROOT / "models"):
        d = Path(models_dir)
        ctx = joblib.load(d / "context.joblib")
        m = joblib.load(d / "skyguard_models.joblib")
        self.clim: Climatology = ctx["clim"]
        self.spatial: SpatialModel = ctx["spatial"]
        self.meta: pd.DataFrame = ctx["meta"]
        self.det = m["detector"]; self.rc = m["root_cause"]; self.classes = m["classes"]
        self.theta = float(m["theta"]); self.fcols = m["feature_cols"]
        self._explainer = None
        self.cold_start: set[str] = set()

    # ------------------------------------------------------------------ helpers
    @property
    def explainer(self):
        if self._explainer is None:
            import shap
            self._explainer = shap.TreeExplainer(self.det)
        return self._explainer

    @staticmethod
    def infer_cadence_h(df: pd.DataFrame) -> float:
        d = df.sort_values(["station_id", "ts"]).groupby("station_id")["ts"].diff().dt.total_seconds().dropna()
        if len(d) == 0:
            return 1.0
        med = float(d.median()) / 3600
        return float(np.clip(med, 1 / 60, 24))

    def regularise(self, df: pd.DataFrame, cadence_h: float) -> pd.DataFrame:
        """Snap to a regular grid per station so gaps become explicit NaN rows; keep duplicates flagged."""
        out = []
        freq = pd.to_timedelta(cadence_h, unit="h")
        end_all = df["ts"].dt.round(freq).max()      # a station silent before the network's latest report = comms gap
        for sid, g in df.groupby("station_id", sort=False):
            g = g.sort_values("ts")
            g["ts"] = g["ts"].dt.round(freq)
            dup = g.duplicated("ts", keep="first")
            g = g[~dup]
            idx = pd.date_range(g["ts"].min(), end_all, freq=freq)
            g = g.set_index("ts").reindex(idx).rename_axis("ts").reset_index()
            g["station_id"] = sid
            g["_dup"] = False
            out.append(g)
        return pd.concat(out, ignore_index=True)

    def register_unseen(self, df: pd.DataFrame, lat_lon: dict | None = None):
        """Cold start: fit a local climatology from the file itself for unknown stations, register coordinates."""
        unseen = [s for s in df["station_id"].unique() if not self.clim.has(s) or s in self.cold_start]   # re-fit cold-start stations per file
        if not unseen:
            return sorted(set(df["station_id"].unique()) & self.cold_start)
        if not hasattr(self, "_mad_prior"):     # network-typical climatological spread per sensor (from trained stations)
            self._mad_prior = {}
            for sen in ("temp", "pres", "rh", "td"):
                v = [np.nanmedian(t[sen]["mad"]) for k, t in self.clim.tables.items() if sen in t and k not in self.cold_start]
                self._mad_prior[sen] = float(np.nanmedian(v)) if v else {"temp": 1.5, "pres": 1.9, "rh": 9.0, "td": 2.0}[sen]
        self.cold_start.update(unseen)
        local = Climatology().fit(df[df["station_id"].isin(unseen)][["station_id", "ts", "temp", "pres", "rh"]])
        for s in unseen:
            self.clim.tables[s] = local.tables[s]; self.clim.step_scale[s] = local.step_scale[s]
            self.clim.streak_p99[s] = local.streak_p99[s]; self.clim.n_hours[s] = local.n_hours[s]
            if local.n_hours[s] < 24 * 60:      # < 2 months of history: a week of data cannot define a tight "normal"
                for sen, t in self.clim.tables[s].items():
                    t["mad"] = np.where(np.isfinite(t["mad"]), np.maximum(t["mad"], self._mad_prior.get(sen, 0.0)), np.nan)
            # fall back to network step scale if the local file is short
            for sen in ("temp", "pres", "rh", "td"):
                if not np.isfinite(self.clim.step_scale[s].get(sen, np.nan)):
                    self.clim.step_scale[s][sen] = self.clim.step_sigma(s, sen)   # network-wide fallback
            if lat_lon and s in lat_lon:
                la, lo, el = lat_lon[s]
                self.spatial.add_station(s, la, lo, el)
        # if several unseen stations came together with coordinates, make them each other's neighbours via SRT on the file
        if lat_lon and len([s for s in unseen if s in lat_lon]) >= 2:
            sub = df[df["station_id"].isin(unseen)]
            meta = pd.DataFrame({s: {"lat": lat_lon[s][0], "lon": lat_lon[s][1], "elev": lat_lon[s][2]} for s in unseen if s in lat_lon}).T
            tmp = SpatialModel().fit(sub[["station_id", "ts", "temp", "pres", "rh"]], meta)
            for s in unseen:
                if tmp.neighbours.get(s):
                    self.spatial.neighbours[s] = tmp.neighbours[s]
                    for k, v in tmp.pairs.items():
                        if k[0] == s:
                            self.spatial.pairs[k] = v
        return sorted(set(df["station_id"].unique()) & self.cold_start)

    # ------------------------------------------------------------------ main entry
    def score_frame(self, raw: pd.DataFrame, explain: bool = True, lat_lon: dict | None = None,
                    already_canonical: bool = False) -> tuple[pd.DataFrame, dict]:
        t0 = time.perf_counter()
        report = {}
        if already_canonical:
            df = raw.copy(); report["schema"] = {"mapped": "canonical"}
        else:
            df, report["schema"] = normalise_schema(raw)
        df = df.dropna(subset=["ts"])
        if len(df) == 0:
            raise ValueError("No rows with a valid timestamp were found in the file.")
        dups = df.duplicated(["station_id", "ts"], keep="first")
        report["duplicates"] = int(dups.sum())
        df = sentinel_to_nan(df) if False else df   # keep sentinels: Tier-1 flags them explicitly
        cadence = self.infer_cadence_h(df)
        report["cadence_h"] = cadence
        # coordinates from file if present
        if lat_lon is None and {"lat", "lon"}.issubset(df.columns):
            lat_lon = {s: (float(g["lat"].iloc[0]), float(g["lon"].iloc[0]), float(g["elev"].iloc[0]) if "elev" in g else 0.0)
                       for s, g in df.groupby("station_id") if np.isfinite(g["lat"].iloc[0])}
        dup_keys = set(map(tuple, df.loc[dups, ["station_id", "ts"]].values))
        df = self.regularise(df[["station_id", "ts", "temp", "pres", "rh"]], cadence)
        report["unseen_stations"] = self.register_unseen(df, lat_lon)
        flags = tier1(df)
        coarse = integer_resolution(df)   # stations logging whole numbers repeat values naturally
        sids = df["station_id"].astype(str).values
        # re-mark duplicate timestamps (lost in regularise)
        if dup_keys:
            k = list(map(tuple, df[["station_id", "ts"]].values))
            flags["duplicate_ts"] = [x in dup_keys for x in k]
        clean = clean_for_features(df, flags)
        feats = compute_features(clean, self.clim, self.spatial if self.spatial.neighbours else None, cadence_h=cadence)
        X = feats[self.fcols].values.astype(np.float32)
        p = self.det.predict(X)
        rc_p = self.rc.predict(X)
        rc_i = rc_p.argmax(1)
        hard_any = flags["hard"] | flags["all_missing"]
        alert = (p >= self.theta) | hard_any.values
        shap_top = [None] * len(df)
        if explain and alert.any():
            idx = np.flatnonzero(alert & ~hard_any.values)
            if len(idx) > 20000:      # keep demo-server latency bounded: explain the strongest 20k alerts
                idx = idx[np.argsort(-p[idx])[:20000]]
            if len(idx):
                sv = self.explainer.shap_values(X[idx])
                sv = sv[1] if isinstance(sv, list) else sv
                for k, i in enumerate(idx):
                    order = np.argsort(-sv[k])[:5]
                    shap_top[i] = [(self.fcols[j], float(sv[k][j])) for j in order if sv[k][j] > 0]
        rows = []
        full = pd.concat([df.reset_index(drop=True), feats.reset_index(drop=True)], axis=1)
        gap = feats["temp_gap_h"].values
        for i in range(len(df)):
            r = full.iloc[i]
            f = flags.iloc[i]
            hard = {"all_missing": bool(f["all_missing"]), "any_fill": bool(f["any_fill"]), "any_oor": bool(f["any_oor"]),
                    "stale": bool(f["stale"]), "duplicate": bool(f["duplicate_ts"]), "td_gt_t": bool(f["td_gt_t"]),
                    "gap_h": float(gap[i]) if np.isfinite(gap[i]) else 1.0, "coarse": coarse.get(sids[i], {})}
            for s in SENSORS:
                if f[f"{s}_fill"]: hard["fill_sensor"] = s
                if f[f"{s}_oor"]: hard["oor_sensor"] = s
            v = verdict(r, float(p[i]), self.theta, hard, self.classes[rc_i[i]], float(rc_p[i].max()), shap_top[i])
            v["p_fault"] = float(p[i]); v["shap_top"] = shap_top[i]
            rows.append(v)
        dec = pd.DataFrame(rows)
        out = pd.concat([df.reset_index(drop=True), dec], axis=1)
        for s in SENSORS:
            out[f"{s}_expected"] = feats[f"{s}_sp_est"].where(feats[f"{s}_sp_n"] > 0, feats[f"{s}_clim_med"]).values
            out[f"{s}_cz"] = feats[f"{s}_cz"].values; out[f"{s}_sp_z"] = feats[f"{s}_sp_z"].values
            out[f"{s}_witness"] = feats[f"{s}_witness"].values
            out[f"{s}_sp_bias_med24"] = feats[f"{s}_sp_bias_med24"].values
            out[f"{s}_sp_slope72_z"] = feats[f"{s}_sp_slope72_z"].values
        dt = time.perf_counter() - t0
        report["rows"] = int(len(out)); report["seconds"] = round(dt, 3); report["ms_per_row"] = round(1000 * dt / max(len(out), 1), 3)
        report["alerts"] = int((out["verdict"] != "NORMAL").sum())
        report["verdict_counts"] = out["verdict"].value_counts().to_dict()
        report["fault_counts"] = out.loc[out["verdict"] == "SENSOR_FAULT", "fault"].value_counts().to_dict()
        return out, report

    def station_health(self, scored: pd.DataFrame) -> dict:
        res = {}
        for sid, g in scored.groupby("station_id"):
            g = g[g["ts"] >= g["ts"].max() - pd.Timedelta(days=7)]
            res[sid] = health_from_history(g)
        return res
