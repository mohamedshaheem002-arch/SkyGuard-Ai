"""SkyGuard AI web app: REST API + dashboard. Run:  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"""
from __future__ import annotations

from collections import OrderedDict
import io, json, math, os, sys, threading, time, uuid, warnings
warnings.filterwarnings("ignore")
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Cookie, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from skyguard.engine import SkyGuard                            # noqa: E402
from skyguard.data import load_network, read_any_table         # noqa: E402
from skyguard.inject import inject                               # noqa: E402
from skyguard.config import FILL_VALUES                         # noqa: E402

# Environment configuration
CORS_ORIGINS_RAW = os.environ.get("SKYGUARD_CORS_ORIGINS", "*").strip()
if CORS_ORIGINS_RAW == "*" or not CORS_ORIGINS_RAW:
    CORS_ORIGINS = ["*"]
else:
    CORS_ORIGINS = [o.strip() for o in CORS_ORIGINS_RAW.split(",") if o.strip()]

MAX_UPLOAD_BYTES = int(os.environ.get("SKYGUARD_MAX_UPLOAD_BYTES", 25 * 1024 * 1024))  # 25 MB default
MAX_UPLOAD_ROWS = int(os.environ.get("SKYGUARD_MAX_UPLOAD_ROWS", 400_000))             # 400k rows default
DEMO_MODE = os.environ.get("SKYGUARD_DEMO_MODE", "true").lower() in ("true", "1", "yes")

app = FastAPI(title="SkyGuard AI", version="2.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True if CORS_ORIGINS != ["*"] else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

ENGINE = SkyGuard()
METRICS = json.load(open(ROOT / "models" / "metrics.json", encoding="utf-8")) if (ROOT / "models" / "metrics.json").exists() else {}
DEMO_START, DEMO_END = "2025-03-01", "2025-06-14"     # test period only - never seen in training

_CACHE: dict = {}


class UploadStore:
    """Thread-safe bounded in-memory store for scored uploads so concurrent users do not overwrite state."""
    def __init__(self, max_entries: int = 50, ttl_seconds: int = 3600):
        self._max = max_entries
        self._ttl = ttl_seconds
        self._store: OrderedDict[str, tuple[float, pd.DataFrame]] = OrderedDict()
        self._lock = threading.Lock()
        self._latest_id: str | None = None

    def save(self, df: pd.DataFrame, session_id: str | None = None) -> str:
        with self._lock:
            sid = session_id or uuid.uuid4().hex
            now = time.time()
            self._prune(now)
            self._store[sid] = (now, df)
            self._latest_id = sid
            if len(self._store) > self._max:
                self._store.popitem(last=False)
            return sid

    def get(self, session_id: str | None = None) -> pd.DataFrame | None:
        with self._lock:
            now = time.time()
            self._prune(now)
            sid = session_id or self._latest_id
            if sid and sid in self._store:
                return self._store[sid][1]
            return None

    def _prune(self, now: float):
        expired = [k for k, (t, _) in self._store.items() if now - t > self._ttl]
        for k in expired:
            del self._store[k]


UPLOAD_STORE = UploadStore()


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


class ObservationIngest(BaseModel):
    station_id: str = Field(..., min_length=1, max_length=64, description="Station identifier")
    timestamp: str = Field(..., description="Timestamp in ISO 8601 or standard datetime format")
    temperature: Optional[float] = Field(None, description="Air temperature in °C or sentinel")
    pressure: Optional[float] = Field(None, description="Atmospheric pressure in hPa or sentinel")
    humidity: Optional[float] = Field(None, description="Relative humidity in % (0-100) or sentinel")

    @field_validator("timestamp")
    @classmethod
    def validate_timestamp(cls, v: str) -> str:
        try:
            parsed = pd.to_datetime(v)
            if pd.isna(parsed):
                raise ValueError("Timestamp could not be parsed")
        except Exception:
            raise ValueError("Invalid timestamp format; use ISO 8601 or standard datetime")
        return v

    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (-80.0 <= v <= 70.0 or v in FILL_VALUES):
            raise ValueError("Temperature must be between -80.0 and 70.0 °C or a recognized sentinel")
        return v

    @field_validator("pressure")
    @classmethod
    def validate_pressure(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (300.0 <= v <= 1100.0 or v in FILL_VALUES):
            raise ValueError("Pressure must be between 300.0 and 1100.0 hPa or a recognized sentinel")
        return v

    @field_validator("humidity")
    @classmethod
    def validate_humidity(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (0.0 <= v <= 100.0 or v in FILL_VALUES):
            raise ValueError("Humidity must be between 0.0 and 100.0 % or a recognized sentinel")
        return v


@app.get("/")
def index():
    return FileResponse(ROOT / "app" / "static" / "index.html", media_type="text/html")


@app.get("/api/health")
def health():
    """System and model readiness health check."""
    try:
        models_ready = (
            hasattr(ENGINE, "det") and ENGINE.det is not None and
            hasattr(ENGINE, "rc") and ENGINE.rc is not None and
            hasattr(ENGINE, "clim") and ENGINE.clim is not None and
            hasattr(ENGINE, "spatial") and ENGINE.spatial is not None
        )
        return _clean({
            "status": "healthy" if models_ready else "degraded",
            "service": "SkyGuard AI",
            "version": "2.0",
            "models_loaded": bool(models_ready),
            "stations_count": len(ENGINE.meta) if hasattr(ENGINE, "meta") and ENGINE.meta is not None else 0,
            "demo_mode": DEMO_MODE,
            "features_count": len(ENGINE.fcols) if hasattr(ENGINE, "fcols") else 0,
            "threshold": getattr(ENGINE, "theta", 0.85),
            "timestamp": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
    except Exception as e:
        raise HTTPException(500, f"Health check failed: {e}")


@app.get("/api/meta")
def meta():
    try:
        m = ENGINE.meta.reset_index()
        return _clean({
            "stations": m.to_dict(orient="records"),
            "theta": ENGINE.theta,
            "n_features": len(ENGINE.fcols),
            "metrics": METRICS,
            "demo_window": [DEMO_START, DEMO_END],
            "neighbours": {k: [n for n, _ in v] for k, v in ENGINE.spatial.neighbours.items()},
            "demo_mode": DEMO_MODE,
            "mode": "DEMO/REPLAY" if DEMO_MODE else "LIVE/PRODUCTION",
        })
    except Exception as e:
        raise HTTPException(500, f"Failed to retrieve metadata: {e}")


@app.get("/api/overview")
def overview():
    try:
        d = demo_scored()
        last = d.sort_values("ts").groupby("station_id").tail(1)
        health = _CACHE["health"]
        per_station = []
        for sid, g in d.groupby("station_id"):
            alerts = g[g["verdict"].isin(["SENSOR_FAULT", "DATA_COMM_ISSUE"])]
            per_station.append({
                "station_id": sid, "n": len(g),
                "faults": int((g["verdict"] == "SENSOR_FAULT").sum()),
                "comm": int((g["verdict"] == "DATA_COMM_ISSUE").sum()),
                "genuine": int((g["verdict"] == "GENUINE_WEATHER_EVENT").sum()),
                "health": health[sid]["station"],
                "sensors": {s: health[sid][s] for s in ("temp", "pres", "rh")},
                "last_alert": alerts["ts"].max() if len(alerts) else None
            })
        latest = {r["station_id"]: r for r in last[ROW_COLS].to_dict(orient="records")}
        return _clean({
            "report": _CACHE["demo_report"],
            "stations": per_station,
            "recent_alerts": alert_episodes(d, cadence_h=float(_CACHE["demo_report"].get("cadence_h", 1.0) or 1.0)),
            "verdict_counts": d["verdict"].value_counts().to_dict(),
            "latest": latest,
            "demo_mode": DEMO_MODE,
        })
    except Exception as e:
        raise HTTPException(500, f"Failed to generate overview: {e}")


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
    try:
        d = demo_scored()
        g = d[d["station_id"] == sid].sort_values("ts")
        if g.empty:
            raise HTTPException(404, f"unknown station ID: {sid}")
        g = g[g["ts"] >= g["ts"].max() - pd.Timedelta(days=days)]
        series = g[["ts", "temp", "pres", "rh", "true_temp", "true_pres", "true_rh", "temp_expected", "pres_expected", "rh_expected",
                    "verdict", "fault", "sensor", "severity", "corrected", "p_fault", "truth_fault"]]
        alerts = g[g["verdict"] != "NORMAL"][ROW_COLS + ["truth_fault"]]
        truth = g["truth_label"].values == 1
        pred = g["verdict"].isin(["SENSOR_FAULT", "DATA_COMM_ISSUE"]).values
        conf = {"tp": int((truth & pred).sum()), "fp": int((~truth & pred).sum()), "fn": int((truth & ~pred).sum()), "tn": int((~truth & ~pred).sum())}
        return _clean({
            "station_id": sid, "series": series.to_dict(orient="list"), "alerts": alerts.to_dict(orient="records"),
            "health": _CACHE["health"].get(sid, {}), "confusion": conf,
            "neighbours": [n for n, _ in ENGINE.spatial.neighbours.get(sid, [])]
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to retrieve station details: {e}")


@app.post("/api/score")
async def score(file: UploadFile = File(...), explain: bool = True, response: Response = None):
    """Judge mode: upload any CSV with timestamp / station / temperature / pressure / humidity columns."""
    try:
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
    except Exception as e:
        raise HTTPException(400, f"could not read upload: {e}")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    try:
        df = read_any_table(raw)
    except Exception as e:
        raise HTTPException(400, f"could not parse CSV: {e}")
    if len(df) > MAX_UPLOAD_ROWS:
        raise HTTPException(400, f"file exceeds maximum allowed rows ({MAX_UPLOAD_ROWS:,})")
    try:
        scored, rep = ENGINE.score_frame(df, explain=explain)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"scoring failed: {e}")

    session_id = uuid.uuid4().hex
    UPLOAD_STORE.save(scored, session_id)
    if response:
        response.set_cookie(key="skyguard_session", value=session_id, max_age=3600, httponly=True, samesite="lax")

    health = ENGINE.station_health(scored)
    alerts = scored[scored["verdict"] != "NORMAL"][ROW_COLS]
    per_station = {sid: {"n": int(len(g)), "verdicts": g["verdict"].value_counts().to_dict(), "health": health.get(sid, {})}
                   for sid, g in scored.groupby("station_id")}
    series = {sid: g.sort_values("ts")[["ts", "temp", "pres", "rh", "temp_expected", "pres_expected", "rh_expected", "verdict", "fault", "sensor", "severity", "corrected", "p_fault"]]
              .tail(2000).to_dict(orient="list") for sid, g in scored.groupby("station_id")}
    rep["upload_id"] = session_id
    return _clean({"report": rep, "alerts": alerts.head(500).to_dict(orient="records"), "stations": per_station, "series": series})


@app.get("/api/download")
def download(id: Optional[str] = Query(None), skyguard_session: Optional[str] = Cookie(None)):
    """Download scored CSV for the user's session, by explicit id, or falling back to latest."""
    target_id = id or skyguard_session
    scored = UPLOAD_STORE.get(target_id)
    if scored is None:
        raise HTTPException(404, "nothing scored yet or session expired")
    cols = ["station_id", "ts", "temp", "pres", "rh", "verdict", "fault", "sensor", "severity", "confidence", "p_fault",
            "corrected", "bias_estimate", "temp_expected", "pres_expected", "rh_expected", "explanation", "action"]
    export_cols = [c for c in cols if c in scored.columns]
    buf = io.StringIO()
    scored[export_cols].to_csv(buf, index=False)
    csv_bytes = buf.getvalue().encode("utf-8")
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="skyguard_scored.csv"'}
    )


@app.get("/api/sample_csv")
def sample_csv():
    """A small messy CSV (odd column names, Kelvin, Pa, fill values, an unseen station) to show judge mode."""
    try:
        d = demo_scored()
        g = d[d["station_id"].isin(["43279", "43331"])].sort_values("ts").groupby("station_id").tail(24 * 10)
        out = pd.DataFrame({
            "Station Name": g["station_id"].map({"43279": "CHENNAI_AWS_7", "43331": "PONDY_AWS_2"}),
            "Date Time": g["ts"].dt.strftime("%d/%m/%Y %H:%M"),
            "Air Temp (K)": (g["temp"] + 273.15).round(2),
            "Pressure (Pa)": (g["pres"] * 100).round(0),
            "Humidity": g["rh"]
        })
        out.loc[out.index[5:8], "Air Temp (K)"] = -999
        buf = io.StringIO()
        out.to_csv(buf, index=False)
        csv_bytes = buf.getvalue().encode("utf-8")
        return StreamingResponse(
            io.BytesIO(csv_bytes),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="sample_judge.csv"'}
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to generate sample CSV: {e}")


@app.post("/api/ingest")
def ingest(obs: ObservationIngest):
    """Lightweight single AWS observation ingestion endpoint.
    Validates observation types/ranges and passes it through the existing SkyGuard engine only.
    """
    try:
        ts = pd.to_datetime(obs.timestamp)
    except Exception as e:
        raise HTTPException(400, f"invalid timestamp: {e}")

    row_df = pd.DataFrame([{
        "station_id": str(obs.station_id).strip(),
        "ts": ts,
        "temp": obs.temperature,
        "pres": obs.pressure,
        "rh": obs.humidity,
    }])

    try:
        scored, rep = ENGINE.score_frame(row_df, explain=True)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"scoring failed: {e}")

    if scored.empty:
        raise HTTPException(500, "engine produced empty result")

    r = scored.iloc[0]
    result = {
        "station_id": str(r["station_id"]),
        "timestamp": pd.Timestamp(r["ts"]).strftime("%Y-%m-%d %H:%M"),
        "temp": r.get("temp"),
        "pres": r.get("pres"),
        "rh": r.get("rh"),
        "verdict": r.get("verdict"),
        "fault": r.get("fault"),
        "sensor": r.get("sensor"),
        "severity": r.get("severity"),
        "confidence": r.get("confidence"),
        "p_fault": r.get("p_fault"),
        "explanation": r.get("explanation"),
        "action": r.get("action"),
        "corrected": r.get("corrected"),
        "bias_estimate": r.get("bias_estimate"),
        "temp_expected": r.get("temp_expected"),
        "pres_expected": r.get("pres_expected"),
        "rh_expected": r.get("rh_expected"),
        "shap_top": r.get("shap_top"),
        "cadence_h": rep.get("cadence_h"),
    }
    return _clean(result)


app.mount("/static", StaticFiles(directory=str(ROOT / "app" / "static")), name="static")

