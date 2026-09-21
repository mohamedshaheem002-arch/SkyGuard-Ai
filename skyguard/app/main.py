"""SkyGuard AI web app: REST API + dashboard. Run:  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"""
from __future__ import annotations

import io, json, math, sys, time, warnings
warnings.filterwarnings("ignore")
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from skyguard.engine import SkyGuard          # noqa: E402
from skyguard.data import load_network, read_any_table   # noqa: E402
from skyguard.inject import inject             # noqa: E402

app = FastAPI(title="SkyGuard AI", version="2.0")
ENGINE = SkyGuard()
METRICS = json.load(open(ROOT / "models" / "metrics.json", encoding="utf-8")) if (ROOT / "models" / "metrics.json").exists() else {}
DEMO_START, DEMO_END = "2025-03-01", "2025-06-14"     # test period only - never seen in training

_CACHE: dict = {}


def _clean(o):
    """JSON-safe conversion (NaN -> null, numpy -> python)."""
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if (o is None or math.isnan(float(o)) or math.isinf(float(o))) else float(o)
    if isinstance(o, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(o).strftime("%Y-%m-%d %H:%M")
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def demo_scored() -> pd.DataFrame:
    """Score the held-out demo window of the real network once (with injected faults) and cache."""
    if "demo" not in _CACHE:
        cache_f = ROOT / "data" / "demo_scored.parquet"; rep_f = ROOT / "data" / "demo_report.json"
        if cache_f.exists() and rep_f.exists():
            scored = pd.read_parquet(cache_f); rep = json.load(open(rep_f, encoding="utf-8"))
            scored["shap_top"] = scored["shap_top"].apply(lambda v: json.loads(v) if isinstance(v, str) and v else None)
        else:
            obs_f = ROOT / "data" / "obs.parquet"
            if obs_f.exists():      # offline: the prepared archive already holds the clean true values
                raw = pd.read_parquet(obs_f, columns=["station_id", "ts", "true_temp", "true_pres", "true_rh"])
                raw = raw[(raw["ts"] >= DEMO_START) & (raw["ts"] < DEMO_END)].rename(columns={"true_temp": "temp", "true_pres": "pres", "true_rh": "rh"})
                raw["station_id"] = raw["station_id"].astype(str); raw = raw.reset_index(drop=True)
            else:
                raw = load_network(start=DEMO_START, end=DEMO_END)
            obs = inject(raw, seed=2026, rate_scale=1.6)
            scored, rep = ENGINE.score_frame(obs[["station_id", "ts", "temp", "pres", "rh"]], already_canonical=True)
            scored["truth_fault"] = obs["fault"].astype(str).values
            scored["truth_label"] = obs["label"].values
            for s in ("temp", "pres", "rh"):
                scored[f"true_{s}"] = obs[f"true_{s}"].values
            tmp = scored.copy(); tmp["shap_top"] = tmp["shap_top"].apply(lambda v: json.dumps(v) if v else "")
            tmp.to_parquet(cache_f, index=False); json.dump(rep, open(rep_f, "w", encoding="utf-8"), default=float)
        _CACHE["demo"] = scored; _CACHE["demo_report"] = rep
        _CACHE["health"] = ENGINE.station_health(scored)
    return _CACHE["demo"]


ROW_COLS = ["ts", "station_id", "temp", "pres", "rh", "verdict", "fault", "sensor", "severity", "confidence", "explanation",
            "action", "corrected", "bias_estimate", "p_fault", "temp_expected", "pres_expected", "rh_expected",
            "temp_cz", "pres_cz", "rh_cz", "temp_sp_z", "pres_sp_z", "rh_sp_z", "temp_witness", "pres_witness", "rh_witness", "shap_top"]


@app.get("/")
def index():
    return FileResponse(ROOT / "app" / "static" / "index.html", media_type="text/html")


@app.get("/api/meta")
def meta():
    m = ENGINE.meta.reset_index()
    return _clean({"stations": m.to_dict(orient="records"), "theta": ENGINE.theta, "n_features": len(ENGINE.fcols),
                   "metrics": METRICS, "demo_window": [DEMO_START, DEMO_END],
                   "neighbours": {k: [n for n, _ in v] for k, v in ENGINE.spatial.neighbours.items()}})


@app.get("/api/overview")
def overview():
    d = demo_scored()
    last = d.sort_values("ts").groupby("station_id").tail(1)
    health = _CACHE["health"]
    per_station = []
    for sid, g in d.groupby("station_id"):
        alerts = g[g["verdict"].isin(["SENSOR_FAULT", "DATA_COMM_ISSUE"])]
        per_station.append({"station_id": sid, "n": len(g), "faults": int((g["verdict"] == "SENSOR_FAULT").sum()),
                            "comm": int((g["verdict"] == "DATA_COMM_ISSUE").sum()), "genuine": int((g["verdict"] == "GENUINE_WEATHER_EVENT").sum()),
                            "health": health[sid]["station"], "sensors": {s: health[sid][s] for s in ("temp", "pres", "rh")},
                            "last_alert": alerts["ts"].max() if len(alerts) else None})
    latest = {r["station_id"]: r for r in last[ROW_COLS].to_dict(orient="records")}   # current reading + verdict per station
    return _clean({"report": _CACHE["demo_report"], "stations": per_station,
                   "recent_alerts": alert_episodes(d, cadence_h=float(_CACHE["demo_report"].get("cadence_h", 1.0) or 1.0)),
                   "verdict_counts": d["verdict"].value_counts().to_dict(), "latest": latest})


def alert_episodes(d: pd.DataFrame, days: int = 7, max_n: int = 80, cadence_h: float = 1.0) -> list[dict]:
    """Collapse consecutive same-station / same-verdict / same-cause rows into alert episodes, so the Alerts page
    shows one line per event (start -> end, hours) and says whether it is still ACTIVE at the station's latest
    reading (= what the Overview shows) or has already cleared."""
    tmax = d["ts"].max()
    a = d[(d["verdict"] != "NORMAL") & (d["ts"] >= tmax - pd.Timedelta(days=days))].sort_values(["station_id", "ts"])
    if a.empty:
        return []
    last_ts = d.groupby("station_id")["ts"].max()
    key = a["station_id"].astype(str) + "|" + a["verdict"].astype(str) + "|" + a["fault"].fillna("").astype(str)
    brk = (key != key.shift()) | ((a["ts"] - a["ts"].shift()) != pd.Timedelta(hours=cadence_h))
    sev_rank = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
    out = []
    for _, g in a.groupby(brk.cumsum()):
        r = g.iloc[-1]
        rec = {c: r[c] for c in ROW_COLS}
        rec["severity"] = max(g["severity"].fillna("LOW"), key=lambda v: sev_rank.get(v, 0))
        rec["start"] = g["ts"].min(); rec["hours"] = int(len(g))
        rec["active"] = bool(g["ts"].max() == last_ts[r["station_id"]])
        out.append(rec)
    pri = {"SENSOR_FAULT": 0, "DATA_COMM_ISSUE": 1, "GENUINE_WEATHER_EVENT": 2, "UNCERTAIN": 3}
    out.sort(key=lambda r: (not r["active"], r["ts"] != tmax, pri.get(r["verdict"], 9) if r["active"] else 0, -r["ts"].value))
    return out[:max_n]


@app.get("/api/station/{sid}")
def station(sid: str, days: int = Query(14, ge=1, le=120)):
    d = demo_scored()
    g = d[d["station_id"] == sid].sort_values("ts")
    if g.empty:
        raise HTTPException(404, "unknown station")
    g = g[g["ts"] >= g["ts"].max() - pd.Timedelta(days=days)]
    series = g[["ts", "temp", "pres", "rh", "true_temp", "true_pres", "true_rh", "temp_expected", "pres_expected", "rh_expected",
                "verdict", "fault", "sensor", "severity", "corrected", "p_fault", "truth_fault"]]
    alerts = g[g["verdict"] != "NORMAL"][ROW_COLS + ["truth_fault"]]
    # confusion for this station in window (truth vs decision)
    truth = g["truth_label"].values == 1
    pred = g["verdict"].isin(["SENSOR_FAULT", "DATA_COMM_ISSUE"]).values
    conf = {"tp": int((truth & pred).sum()), "fp": int((~truth & pred).sum()), "fn": int((truth & ~pred).sum()), "tn": int((~truth & ~pred).sum())}
    return _clean({"station_id": sid, "series": series.to_dict(orient="list"), "alerts": alerts.to_dict(orient="records"),
                   "health": _CACHE["health"][sid], "confusion": conf,
                   "neighbours": [n for n, _ in ENGINE.spatial.neighbours.get(sid, [])]})


@app.post("/api/score")
async def score(file: UploadFile = File(...), explain: bool = True):
    """Judge mode: upload any CSV with timestamp / station / temperature / pressure / humidity columns."""
    raw = await file.read()
    try:
        df = read_any_table(raw)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"could not parse CSV: {e}")
    if len(df) > 400_000:
        raise HTTPException(400, "file too large for the demo server (max 400k rows)")
    try:
        scored, rep = ENGINE.score_frame(df, explain=explain)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _CACHE["upload"] = scored
    health = ENGINE.station_health(scored)
    alerts = scored[scored["verdict"] != "NORMAL"][ROW_COLS]
    per_station = {sid: {"n": int(len(g)), "verdicts": g["verdict"].value_counts().to_dict(), "health": health[sid]}
                   for sid, g in scored.groupby("station_id")}
    series = {sid: g.sort_values("ts")[["ts", "temp", "pres", "rh", "temp_expected", "pres_expected", "rh_expected", "verdict", "fault", "sensor", "severity", "corrected", "p_fault"]]
              .tail(2000).to_dict(orient="list") for sid, g in scored.groupby("station_id")}
    return _clean({"report": rep, "alerts": alerts.head(500).to_dict(orient="records"), "stations": per_station, "series": series})


@app.get("/api/download")
def download():
    if "upload" not in _CACHE:
        raise HTTPException(404, "nothing scored yet")
    p = ROOT / "data" / "last_scored.csv"
    cols = ["station_id", "ts", "temp", "pres", "rh", "verdict", "fault", "sensor", "severity", "confidence", "p_fault",
            "corrected", "bias_estimate", "temp_expected", "pres_expected", "rh_expected", "explanation", "action"]
    _CACHE["upload"][cols].to_csv(p, index=False)
    return FileResponse(p, filename="skyguard_scored.csv")


@app.get("/api/sample_csv")
def sample_csv():
    """A small messy CSV (odd column names, Kelvin, Pa, fill values, an unseen station) to show judge mode."""
    d = demo_scored()
    g = d[d["station_id"].isin(["43279", "43331"])].sort_values("ts").groupby("station_id").tail(24 * 10)
    out = pd.DataFrame({"Station Name": g["station_id"].map({"43279": "CHENNAI_AWS_7", "43331": "PONDY_AWS_2"}),
                        "Date Time": g["ts"].dt.strftime("%d/%m/%Y %H:%M"),
                        "Air Temp (K)": (g["temp"] + 273.15).round(2), "Pressure (Pa)": (g["pres"] * 100).round(0), "Humidity": g["rh"]})
    out.loc[out.index[5:8], "Air Temp (K)"] = -999
    p = ROOT / "data" / "sample_judge.csv"; out.to_csv(p, index=False)
    return FileResponse(p, filename="sample_judge.csv")


app.mount("/static", StaticFiles(directory=str(ROOT / "app" / "static")), name="static")
