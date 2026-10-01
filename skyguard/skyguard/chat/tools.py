"""Read-only data access tools for Groq AI Chatbot.

All tools read directly from existing SkyGuard caches, UPLOAD_STORE, and pre-computed
verdict/SHAP data frames. No ML training, feature pipelines, or scoring logic is modified.
"""
from __future__ import annotations

import json
import math
from typing import Any, Callable, Dict, List, Optional
import numpy as np
import pandas as pd

# Safe JSON serialization helper for tool returns
def _safe_serialize(o: Any) -> Any:
    if isinstance(o, dict):
        return {str(k): _safe_serialize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_safe_serialize(v) for v in o]
    if isinstance(o, (np.integer, int)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if (math.isnan(float(o)) or math.isinf(float(o))) else round(float(o), 3)
    if isinstance(o, (pd.Timestamp, np.datetime64)):
        return pd.Timestamp(o).strftime("%Y-%m-%d %H:%M")
    if isinstance(o, np.bool_):
        return bool(o)
    if pd.isna(o):
        return None
    return o


# State access registry to avoid circular imports with app.main
class ChatContextRegistry:
    _demo_loader: Optional[Callable[[], pd.DataFrame]] = None
    _cache_getter: Optional[Callable[[], dict]] = None
    _upload_store_getter: Optional[Callable[[], Any]] = None
    _engine_getter: Optional[Callable[[], Any]] = None
    _alert_episodes_fn: Optional[Callable[..., list]] = None

    @classmethod
    def register(
        cls,
        demo_loader: Callable[[], pd.DataFrame],
        cache_getter: Callable[[], dict],
        upload_store_getter: Callable[[], Any],
        engine_getter: Callable[[], Any],
        alert_episodes_fn: Callable[..., list],
    ):
        cls._demo_loader = demo_loader
        cls._cache_getter = cache_getter
        cls._upload_store_getter = upload_store_getter
        cls._engine_getter = engine_getter
        cls._alert_episodes_fn = alert_episodes_fn

    @classmethod
    def get_df(cls, upload_id: Optional[str] = None) -> Optional[pd.DataFrame]:
        if upload_id and cls._upload_store_getter:
            store = cls._upload_store_getter()
            if store:
                df = store.get(upload_id)
                if df is not None:
                    return df
        if cls._demo_loader:
            return cls._demo_loader()
        return None

    @classmethod
    def get_cache(cls) -> dict:
        return cls._cache_getter() if cls._cache_getter else {}

    @classmethod
    def get_engine(cls) -> Any:
        return cls._engine_getter() if cls._engine_getter else None

    @classmethod
    def get_alert_episodes(cls, df: pd.DataFrame, days: int = 7, max_n: int = 50) -> list:
        if cls._alert_episodes_fn:
            return cls._alert_episodes_fn(df, days=days, max_n=max_n)
        return []


# ============================================================================
# Tool Implementations (Read-Only)
# ============================================================================

def get_network_summary(upload_id: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve high-level network status, overall health distribution, total alert counts, and verdict breakdown."""
    df = ChatContextRegistry.get_df(upload_id)
    if df is None:
        return {"error": "No network telemetry data available."}

    cache = ChatContextRegistry.get_cache()
    engine = ChatContextRegistry.get_engine()

    if upload_id:
        # Uploaded batch dataset
        stations = [str(s) for s in df["station_id"].unique()]
        verdict_counts = df["verdict"].value_counts().to_dict()
        fault_counts = df.loc[df["verdict"] == "SENSOR_FAULT", "fault"].value_counts().to_dict()
        return _safe_serialize({
            "mode": f"Uploaded Dataset ({upload_id[:8]}...)",
            "total_observations": len(df),
            "total_stations": len(stations),
            "station_ids": stations[:20],
            "verdict_counts": verdict_counts,
            "sensor_fault_breakdown": fault_counts,
            "active_alerts_count": int((df["verdict"] != "NORMAL").sum()),
        })

    # Default demo/replay network
    report = cache.get("demo_report", {})
    health_dict = cache.get("health", {})
    stations_meta = engine.meta if (engine and hasattr(engine, "meta")) else None

    health_status_counts = {"HEALTHY": 0, "WATCH": 0, "MAINTENANCE": 0, "CRITICAL": 0}
    for sid, h in health_dict.items():
        st = h.get("station", {}).get("status", "HEALTHY")
        if st in health_status_counts:
            health_status_counts[st] += 1

    return _safe_serialize({
        "mode": "Demonstration Network (43 Indian WMO Stations)",
        "total_stations": len(stations_meta) if stations_meta is not None else len(health_dict),
        "total_observations": report.get("rows", len(df)),
        "anomalous_observations": report.get("alerts", int((df["verdict"] != "NORMAL").sum())),
        "cadence_hours": report.get("cadence_h", 1.0),
        "verdict_counts": report.get("verdict_counts", df["verdict"].value_counts().to_dict()),
        "sensor_fault_breakdown": report.get("fault_counts", {}),
        "station_health_distribution": health_status_counts,
    })


def get_station_health(station_id: str, upload_id: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve detailed sensor health scores (0-100), operational status, 24h bias, and drift slope for a specific station."""
    sid = str(station_id).strip()
    cache = ChatContextRegistry.get_cache()
    engine = ChatContextRegistry.get_engine()

    if upload_id:
        df = ChatContextRegistry.get_df(upload_id)
        if df is None:
            return {"error": f"Upload session {upload_id} not found or expired."}
        g = df[df["station_id"].astype(str) == sid]
        if g.empty:
            return {"error": f"Station {sid} not found in uploaded dataset."}
        if engine and hasattr(engine, "station_health"):
            health_map = engine.station_health(g)
            return _safe_serialize({"station_id": sid, "health": health_map.get(sid, {})})
        return {"error": "Station health calculator unavailable."}

    health_dict = cache.get("health", {})
    if sid not in health_dict:
        # Check if station exists in meta
        engine = ChatContextRegistry.get_engine()
        known = list(engine.meta.index) if (engine and hasattr(engine, "meta")) else []
        return {
            "error": f"Station '{sid}' not found.",
            "available_stations_sample": [str(s) for s in known[:10]],
        }

    return _safe_serialize({
        "station_id": sid,
        "station_health": health_dict[sid].get("station", {}),
        "sensors": {
            "temperature": health_dict[sid].get("temp", {}),
            "pressure": health_dict[sid].get("pres", {}),
            "humidity": health_dict[sid].get("rh", {}),
        },
    })


def get_station_timeseries(
    station_id: str,
    hours: int = 12,
    upload_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Retrieve recent physical observations, expected values, spatial residuals, and verdicts for a station."""
    sid = str(station_id).strip()
    df = ChatContextRegistry.get_df(upload_id)
    if df is None:
        return {"error": "No telemetry data available."}

    g = df[df["station_id"].astype(str) == sid].sort_values("ts")
    if g.empty:
        return {"error": f"Station '{sid}' not found in active telemetry."}

    h = max(1, min(int(hours), 24))  # compact window (up to 24 hours) to preserve token budget
    recent = g.tail(h)

    cols_to_extract = [
        "ts", "temp", "pres", "rh", "verdict", "fault", "sensor", "severity",
        "p_fault", "corrected", "bias_estimate", "action"
    ]
    present_cols = [c for c in cols_to_extract if c in recent.columns]
    records = recent[present_cols].to_dict(orient="records")

    return _safe_serialize({
        "station_id": sid,
        "hours_requested": h,
        "points_returned": len(records),
        "latest_observation": records[-1] if records else None,
        "timeseries_sample": records,
    })


def get_active_alerts(
    station_id: Optional[str] = None,
    severity: Optional[str] = None,
    upload_id: Optional[str] = None,
    limit: int = 10,
) -> Dict[str, Any]:
    """Retrieve recent active or episodic alert records (faults, weather events, comms issues)."""
    df = ChatContextRegistry.get_df(upload_id)
    if df is None:
        return {"error": "No telemetry data available."}

    episodes = ChatContextRegistry.get_alert_episodes(df, days=7, max_n=50)

    # Filter by station if provided
    if station_id:
        sid = str(station_id).strip()
        episodes = [e for e in episodes if str(e.get("station_id")) == sid]

    # Filter by severity if provided
    if severity:
        sev = severity.strip().upper()
        episodes = [e for e in episodes if str(e.get("severity", "")).upper() == sev]

    max_records = max(1, min(int(limit), 15))
    selected = episodes[:max_records]

    # Keep only key summary columns per alert episode to keep prompt concise
    compact_alerts = []
    for a in selected:
        compact_alerts.append({
            "station_id": a.get("station_id"),
            "start": str(a.get("start")),
            "hours": a.get("hours"),
            "verdict": a.get("verdict"),
            "fault": a.get("fault"),
            "sensor": a.get("sensor"),
            "severity": a.get("severity"),
            "active": a.get("active"),
            "action": a.get("action"),
        })

    return _safe_serialize({
        "total_alerts_found": len(episodes),
        "returned_count": len(compact_alerts),
        "alerts": compact_alerts,
    })


def inspect_upload(upload_id: str) -> Dict[str, Any]:
    """Audit and summarize an uploaded CSV/XLSX file scored in Judge Mode."""
    uid = str(upload_id).strip()
    df = ChatContextRegistry.get_df(uid)
    if df is None:
        return {
            "error": f"Upload ID '{uid}' not found in active session store (may have expired).",
        }

    stations = [str(s) for s in df["station_id"].unique()]
    alerts_df = df[df["verdict"] != "NORMAL"]
    
    # Top 5 most anomalous stations
    station_alert_counts = alerts_df["station_id"].astype(str).value_counts().head(5).to_dict()

    # Top critical anomalies sample
    top_alerts_cols = [
        "ts", "station_id", "temp", "pres", "rh", "verdict", "fault",
        "sensor", "severity", "confidence", "explanation", "action"
    ]
    present_cols = [c for c in top_alerts_cols if c in df.columns]
    top_alerts = alerts_df.sort_values("p_fault", ascending=False)[present_cols].head(8).to_dict(orient="records")

    return _safe_serialize({
        "upload_id": uid,
        "total_rows": len(df),
        "stations_count": len(stations),
        "station_ids": stations,
        "anomalies_count": len(alerts_df),
        "verdict_distribution": df["verdict"].value_counts().to_dict(),
        "fault_types": df.loc[df["verdict"] == "SENSOR_FAULT", "fault"].value_counts().to_dict(),
        "most_faulty_stations": station_alert_counts,
        "sample_top_anomalies": top_alerts,
    })


def explain_shap_features(
    station_id: str,
    timestamp: str,
    upload_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Retrieve TreeExplainer SHAP attribution breakdown and physical drivers for a specific observation."""
    sid = str(station_id).strip()
    df = ChatContextRegistry.get_df(upload_id)
    if df is None:
        return {"error": "No telemetry data available."}

    try:
        target_ts = pd.to_datetime(timestamp)
    except Exception as e:
        return {"error": f"Invalid timestamp format '{timestamp}': {e}"}

    # Match station and timestamp (allowing ±5 minutes if exact timestamp rounding differs)
    st_df = df[df["station_id"].astype(str) == sid]
    if st_df.empty:
        return {"error": f"Station '{sid}' not found."}

    match = st_df[st_df["ts"] == target_ts]
    if match.empty:
        # Fall back to closest reading within 1 hour
        st_df_sorted = st_df.copy()
        st_df_sorted["diff"] = (st_df_sorted["ts"] - target_ts).abs()
        closest = st_df_sorted.sort_values("diff").iloc[0]
        if closest["diff"] > pd.Timedelta(hours=2):
            return {
                "error": f"No observation found for station {sid} near {timestamp}.",
                "available_window": [
                    st_df["ts"].min().strftime("%Y-%m-%d %H:%M"),
                    st_df["ts"].max().strftime("%Y-%m-%d %H:%M"),
                ],
            }
        row = closest
    else:
        row = match.iloc[0]

    shap_top = row.get("shap_top")
    if isinstance(shap_top, str) and shap_top:
        try:
            shap_top = json.loads(shap_top)
        except Exception:
            pass

    return _safe_serialize({
        "station_id": sid,
        "timestamp": pd.Timestamp(row["ts"]).strftime("%Y-%m-%d %H:%M"),
        "verdict": row.get("verdict"),
        "fault": row.get("fault"),
        "sensor": row.get("sensor"),
        "severity": row.get("severity"),
        "p_fault": row.get("p_fault"),
        "plain_explanation": row.get("explanation"),
        "prescribed_action": row.get("action"),
        "corrected_value": row.get("corrected"),
        "bias_estimate": row.get("bias_estimate"),
        "top_shap_features": shap_top if shap_top else "Within normal bounds (no anomaly attribution required)",
        "physical_context": {
            "temp": row.get("temp"),
            "pres": row.get("pres"),
            "rh": row.get("rh"),
            "temp_expected": row.get("temp_expected"),
            "pres_expected": row.get("pres_expected"),
            "rh_expected": row.get("rh_expected"),
            "temp_cz": row.get("temp_cz"),
            "pres_cz": row.get("pres_cz"),
            "rh_cz": row.get("rh_cz"),
            "temp_sp_z": row.get("temp_sp_z"),
            "pres_sp_z": row.get("pres_sp_z"),
            "rh_sp_z": row.get("rh_sp_z"),
            "temp_witness": row.get("temp_witness"),
        },
    })


# ============================================================================
# Groq Function / Tool Schema Definitions
# ============================================================================

GROQ_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_network_summary",
            "description": "Retrieve high-level network status, overall health distribution, total alert counts, and verdict breakdown across all stations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "upload_id": {
                        "type": "string",
                        "description": "Optional session ID if querying a user-uploaded CSV file.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_station_health",
            "description": "Retrieve per-sensor health scores (0-100), operational status (HEALTHY, WATCH, MAINTENANCE, CRITICAL), 24h bias, and drift slope for a specific station.",
            "parameters": {
                "type": "object",
                "properties": {
                    "station_id": {
                        "type": "string",
                        "description": "The station ID (e.g., '43279', '42182', '43331').",
                    },
                    "upload_id": {
                        "type": "string",
                        "description": "Optional upload session ID if querying an uploaded dataset.",
                    },
                },
                "required": ["station_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_station_timeseries",
            "description": "Retrieve recent physical observations, expected values, spatial residuals, and verdicts for a specific station over a time window.",
            "parameters": {
                "type": "object",
                "properties": {
                    "station_id": {
                        "type": "string",
                        "description": "The station ID to retrieve data for.",
                    },
                    "hours": {
                        "type": "integer",
                        "description": "Number of recent hourly observations to fetch (default: 48, max: 168).",
                    },
                    "upload_id": {
                        "type": "string",
                        "description": "Optional upload session ID.",
                    },
                },
                "required": ["station_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_active_alerts",
            "description": "Retrieve active and recent alert episodes (faults, severe weather events, comms issues) across the network or for a specific station.",
            "parameters": {
                "type": "object",
                "properties": {
                    "station_id": {
                        "type": "string",
                        "description": "Optional station ID filter.",
                    },
                    "severity": {
                        "type": "string",
                        "description": "Optional severity filter: 'LOW', 'MEDIUM', 'HIGH', or 'CRITICAL'.",
                    },
                    "upload_id": {
                        "type": "string",
                        "description": "Optional upload session ID.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of alerts to return (default: 20, max: 50).",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_upload",
            "description": "Audit and summarize an uploaded CSV/XLSX file scored in Judge Mode (total rows, affected stations, fault counts, and top anomalies).",
            "parameters": {
                "type": "object",
                "properties": {
                    "upload_id": {
                        "type": "string",
                        "description": "The upload session ID returned when the file was scored.",
                    }
                },
                "required": ["upload_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain_shap_features",
            "description": "Retrieve TreeExplainer SHAP feature contributions and physical drivers for a specific station reading at a timestamp.",
            "parameters": {
                "type": "object",
                "properties": {
                    "station_id": {
                        "type": "string",
                        "description": "The station ID.",
                    },
                    "timestamp": {
                        "type": "string",
                        "description": "The timestamp of the observation (ISO format or 'YYYY-MM-DD HH:MM').",
                    },
                    "upload_id": {
                        "type": "string",
                        "description": "Optional upload session ID.",
                    },
                },
                "required": ["station_id", "timestamp"],
            },
        },
    },
]

# Dispatcher mapping function names to callable functions
TOOL_MAP: Dict[str, Callable[..., Any]] = {
    "get_network_summary": get_network_summary,
    "get_station_health": get_station_health,
    "get_station_timeseries": get_station_timeseries,
    "get_active_alerts": get_active_alerts,
    "inspect_upload": inspect_upload,
    "explain_shap_features": explain_shap_features,
}


def execute_tool_call(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Safely execute a tool function called by Groq and return a dictionary result."""
    func = TOOL_MAP.get(name)
    if not func:
        return {"error": f"Tool '{name}' is not recognized."}
    try:
        return func(**arguments)
    except Exception as e:
        return {"error": f"Error executing tool '{name}': {str(e)}"}
