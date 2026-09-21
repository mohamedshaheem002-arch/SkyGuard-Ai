"""Data access: Meteostat bulk hourly archive (NOAA ISD / national SYNOP), station metadata,
and a tolerant schema normaliser for arbitrary judge-supplied CSV files."""
from __future__ import annotations

import gzip
import io
import json
import os
import re
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .config import FILL_VALUES

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data_cache"
CACHE.mkdir(exist_ok=True)

# Curated network: dense clusters (for spatial tests) + diverse climates (for climatology tests).
NETWORK = {
    # Delhi / NW plains
    "42182": "New Delhi Safdarjung", "42181": "New Delhi Palam", "42260": "Agra", "42348": "Jaipur",
    "42189": "Bareilly", "42361": "Gwalior", "42105": "Chandigarh", "42369": "Lucknow", "42071": "Amritsar",
    # Mumbai / Konkan / Deccan
    "43003": "Mumbai Santacruz", "43002": "Mumbai Juhu", "43057": "Mumbai Colaba", "43001": "Dahanu",
    "43058": "Alibag", "43063": "Pune", "42921": "Nashik", "42840": "Surat", "43014": "Aurangabad",
    # Chennai / TN
    "43279": "Chennai Meenambakkam", "43331": "Puducherry", "43303": "Vellore",
    # Bengaluru / S. Deccan
    "43295": "Bengaluru City", "43296": "Bengaluru HAL", "43291": "Mysuru", "43321": "Coimbatore",
    # Kerala coast
    "43353": "Kochi", "43371": "Thiruvananthapuram", "43314": "Kozhikode", "43357": "Thrissur",
    # Kolkata / Bengal delta
    "42809": "Kolkata Dum Dum", "42807": "Kolkata Alipore", "42812": "Canning", "42811": "Diamond Harbour",
    # Central / others
    "42971": "Bhubaneswar", "42667": "Bhopal", "42754": "Indore", "42867": "Nagpur", "42647": "Ahmedabad",
    "43128": "Hyderabad", "43181": "Vijayawada",
    # Hill / cold stations
    "42042": "Srinagar", "43339": "Kodaikanal", "43317": "Udhagamandalam (Ooty)",
}

BULK = "https://bulk.meteostat.net/v2/hourly/{sid}.csv.gz"
STATIONS_URL = "https://bulk.meteostat.net/v2/stations/lite.json.gz"
COLS = ["date", "hour", "temp", "dwpt", "rhum", "prcp", "snow", "wdir", "wspd", "wpgt", "pres", "tsun", "coco"]


def load_station_meta() -> pd.DataFrame:
    fn = CACHE / "stations_lite.json.gz"
    if not fn.exists():
        r = requests.get(STATIONS_URL, timeout=60); r.raise_for_status(); fn.write_bytes(r.content)
    st = json.load(gzip.open(fn))
    rows = []
    for s in st:
        if s["id"] in NETWORK:
            rows.append({"station_id": s["id"], "name": NETWORK[s["id"]],
                         "lat": s["location"]["latitude"], "lon": s["location"]["longitude"],
                         "elev": s["location"]["elevation"] or 0.0, "region": s.get("region") or ""})
    meta = pd.DataFrame(rows).set_index("station_id").loc[[k for k in NETWORK if k in {r["station_id"] for r in rows}]]
    return meta


def fetch_station(sid: str) -> Path:
    fn = CACHE / f"{sid}.csv.gz"
    if not fn.exists() or fn.stat().st_size < 1000:
        r = requests.get(BULK.format(sid=sid), timeout=120); r.raise_for_status(); fn.write_bytes(r.content)
    return fn


def load_station(sid: str, start="2022-01-01", end="2025-06-14") -> pd.DataFrame:
    fn = fetch_station(sid)
    df = pd.read_csv(fn, names=COLS, usecols=["date", "hour", "temp", "rhum", "pres"], dtype={"date": str})
    df = df[(df["date"] >= start) & (df["date"] < end)].copy()
    df["ts"] = pd.to_datetime(df["date"]) + pd.to_timedelta(df["hour"], unit="h")
    df = df.rename(columns={"rhum": "rh"})[["ts", "temp", "pres", "rh"]]
    df.insert(0, "station_id", sid)
    return df.reset_index(drop=True)


def load_network(start="2022-01-01", end="2025-06-14", stations=None) -> pd.DataFrame:
    meta = load_station_meta()
    ids = list(stations or meta.index)
    frames = [load_station(s, start, end) for s in ids]
    df = pd.concat(frames, ignore_index=True)
    # complete hourly grid per station so "missing" is explicit (NaN rows)
    out = []
    for sid, g in df.groupby("station_id", sort=False):
        idx = pd.date_range(g["ts"].min(), g["ts"].max(), freq="h")
        g = g.set_index("ts").reindex(idx).rename_axis("ts").reset_index()
        g["station_id"] = sid
        out.append(g)
    df = pd.concat(out, ignore_index=True)
    df["station_id"] = df["station_id"].astype(str)
    return df[["station_id", "ts", "temp", "pres", "rh"]]


# --------------------------------------------------------------------------------------
# Schema normaliser for arbitrary CSV (judge mode)
# --------------------------------------------------------------------------------------
_ALIASES = {
    "ts": ["timestamp", "time", "datetime", "date_time", "obs_time", "observation_time", "ts", "date", "dt", "utc", "recorded_at"],
    "station_id": ["station_id", "station", "stn", "stn_id", "site", "site_id", "aws_id", "id", "sensor_id", "device_id", "wmo", "wmo_id", "name", "station_name"],
    "temp": ["temp", "temperature", "t", "tair", "air_temp", "air_temperature", "temp_c", "temperature_c", "t2m", "temperature_2m", "dry_bulb", "ta"],
    "pres": ["pres", "pressure", "p", "press", "slp", "mslp", "station_pressure", "stn_pressure", "surface_pressure", "pressure_hpa", "baro", "barometric_pressure", "qfe", "qnh", "atm_pressure", "atmospheric_pressure"],
    "rh": ["rh", "rhum", "humidity", "relative_humidity", "rel_hum", "relhum", "hum", "rh_pct", "relative_humidity_2m", "humidity_pct", "h"],
    "lat": ["lat", "latitude"], "lon": ["lon", "lng", "long", "longitude"], "elev": ["elev", "elevation", "alt", "altitude", "height"],
}


def _norm(c: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(c).strip().lower()).strip("_")


_KEYWORDS = {  # fallback fuzzy matching: canonical -> substrings that identify it (checked in order)
    "ts": ["timestamp", "datetime", "date_time", "obs_time", "time", "date"],
    "temp": ["temperature", "air_temp", "temp", "tair", "dry_bulb", "t2m"],
    "pres": ["pressure", "press", "pres", "mslp", "slp", "qfe", "qnh", "baro"],
    "rh": ["relative_humidity", "humidity", "rhum", "rh", "hum"],
    "station_id": ["station", "stn", "site", "aws", "sensor_id", "device", "wmo"],
    "lat": ["latitude", "lat"], "lon": ["longitude", "lon", "lng"], "elev": ["elevation", "elev", "altitude", "alt"],
}
_EXCLUDE = {"temp": ["dew", "dwpt", "soil", "water", "sea", "min", "max", "feel"], "pres": ["vapour", "vapor", "tend"], "rh": ["soil", "leaf", "min", "max"],
            "ts": ["update", "created", "zone"], "station_id": ["name_of_file"]}


def normalise_schema(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Map arbitrary column names to the canonical schema. Returns (df, mapping_report)."""
    cols = {_norm(c): c for c in df.columns}
    mapping, report = {}, {"mapped": {}, "unmapped": [], "notes": []}
    # pass 1: exact alias
    for canon, aliases in _ALIASES.items():
        for a in aliases:
            if a in cols and cols[a] not in mapping.values():
                mapping[canon] = cols[a]; break
    # pass 2: keyword / substring match on the normalised name (e.g. "air_temp_k", "pressure_pa", "date_time")
    for canon, keys in _KEYWORDS.items():
        if canon in mapping:
            continue
        for k in keys:
            hit = [c for n, c in cols.items() if k in n and c not in mapping.values() and not any(x in n for x in _EXCLUDE.get(canon, []))]
            if hit:
                mapping[canon] = hit[0]; break
    # pass 3: by content, if still missing (numeric ranges)
    num = [c for c in df.columns if c not in mapping.values() and pd.api.types.is_numeric_dtype(df[c])]
    def med(c):
        v = pd.to_numeric(df[c], errors="coerce"); v = v[(v > -900) & (v < 200000)]
        return float(v.median()) if len(v) else np.nan
    for c in num:
        m = med(c)
        if "pres" not in mapping and (850 < m < 1100 or 85000 < m < 110000): mapping["pres"] = c; report["notes"].append(f"pressure inferred from values of '{c}'"); continue
        if "temp" not in mapping and (-40 < m < 50 or 230 < m < 330): mapping["temp"] = c; report["notes"].append(f"temperature inferred from values of '{c}'"); continue
        if "rh" not in mapping and 0 <= m <= 100: mapping["rh"] = c; report["notes"].append(f"humidity inferred from values of '{c}'")
    if "ts" not in mapping:
        for c in df.columns:
            if c in mapping.values() or pd.api.types.is_numeric_dtype(df[c]):
                continue
            parsed = pd.to_datetime(df[c].head(50), errors="coerce", dayfirst=True)
            if parsed.notna().mean() > 0.8:
                mapping["ts"] = c; report["notes"].append(f"timestamp inferred from '{c}'"); break
    report["mapped"] = dict(mapping)
    # date + hour split columns (Meteostat style)
    if "ts" not in mapping and "date" in cols and "hour" in cols:
        df = df.copy(); df["__ts"] = pd.to_datetime(df[cols["date"]]) + pd.to_timedelta(df[cols["hour"]], unit="h")
        mapping["ts"] = "__ts"; report["notes"].append("combined date+hour into timestamp")
    missing = [c for c in ("ts", "temp", "pres", "rh") if c not in mapping]
    if missing:
        raise ValueError(f"Could not identify columns for {missing}. Columns seen: {list(df.columns)}")
    out = pd.DataFrame({k: df[v] for k, v in mapping.items()})
    if "station_id" not in out:
        out["station_id"] = "STATION_1"; report["notes"].append("no station column - treated as single station")
    out["station_id"] = out["station_id"].astype(object).where(out["station_id"].notna(), "UNKNOWN").astype(str).str.strip().replace({"": "UNKNOWN", "nan": "UNKNOWN", "None": "UNKNOWN"})
    ts_raw = out["ts"]
    parsed = pd.to_datetime(ts_raw, errors="coerce", utc=False, format="mixed") if not pd.api.types.is_datetime64_any_dtype(ts_raw) else ts_raw
    if not pd.api.types.is_datetime64_any_dtype(ts_raw):
        alt = pd.to_datetime(ts_raw, errors="coerce", utc=False, dayfirst=True, format="mixed")
        # prefer the parse that yields a monotone-ish, more complete series (dd/mm vs mm/dd ambiguity)
        if alt.notna().sum() > parsed.notna().sum() or (alt.notna().sum() == parsed.notna().sum() and alt.is_monotonic_increasing and not parsed.is_monotonic_increasing):
            parsed = alt; report["notes"].append("timestamps parsed as day-first")
        if pd.api.types.is_numeric_dtype(ts_raw):
            unit = "ms" if ts_raw.median() > 1e11 else "s"
            parsed = pd.to_datetime(ts_raw, unit=unit, errors="coerce"); report["notes"].append(f"epoch {unit} timestamps")
    out["ts"] = parsed
    if out["ts"].dt.tz is not None:
        out["ts"] = out["ts"].dt.tz_convert("UTC").dt.tz_localize(None)
    for c in ("temp", "pres", "rh"):
        out[c] = pd.to_numeric(out[c], errors="coerce")
    # sentinel / fill values are flagged BEFORE unit conversion (a -999 K must stay -999)
    sentinel = {c: out[c].isin(FILL_VALUES) for c in ("temp", "pres", "rh")}
    if 850 < out["pres"].median() < 1100:      # already hPa: 999.9 is a genuine reading, not a sentinel
        sentinel["pres"] &= ~out["pres"].between(850, 1090)
    # unit heuristics
    if out["temp"].median() > 200: out["temp"] -= 273.15; report["notes"].append("temperature Kelvin -> °C")
    elif out["temp"].quantile(0.99) > 70: out["temp"] = (out["temp"] - 32) * 5 / 9; report["notes"].append("temperature °F -> °C")
    pm = out["pres"].median()
    if 85000 < pm < 110000: out["pres"] /= 100; report["notes"].append("pressure Pa -> hPa")
    elif 25 < pm < 33: out["pres"] *= 33.8639; report["notes"].append("pressure inHg -> hPa")
    elif 600 < pm < 850: out["pres"] *= 1.33322; report["notes"].append("pressure mmHg -> hPa")
    if out["rh"].quantile(0.99) <= 1.0: out["rh"] *= 100; report["notes"].append("RH fraction -> %")
    for c, m in sentinel.items():
        out.loc[m, c] = -999.0
    report["unmapped"] = [c for c in df.columns if c not in mapping.values()]
    return out, report


def sentinel_to_nan(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in ("temp", "pres", "rh"):
        df.loc[df[c].isin(FILL_VALUES), c] = np.nan
    return df


def read_any_table(raw: bytes) -> pd.DataFrame:
    """Robust file reader for judge uploads / CLI: xlsx, UTF-8/16 with or without BOM, any delimiter (, ; tab |),
    quoted fields, spaces after delimiters, Excel exports."""
    import io
    if raw[:2] == b"PK":                                   # .xlsx
        return pd.read_excel(io.BytesIO(raw))
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):             # UTF-16 BOM
        text = raw.decode("utf-16", errors="replace")
    elif len(raw) > 4 and raw[1:2] == b"\x00" and raw[3:4] == b"\x00":   # UTF-16 LE without BOM
        text = raw.decode("utf-16-le", errors="replace")
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("latin-1", errors="replace")
    text = text.lstrip("\ufeff")
    best = None
    for kw in ({"sep": None, "engine": "python"}, {"sep": None, "engine": "python", "skipinitialspace": True},
               {"sep": ",", "skipinitialspace": True}, {"sep": ";", "skipinitialspace": True}, {"sep": "\t"}, {"sep": "|"}):
        try:
            df = pd.read_csv(io.StringIO(text), **kw)
        except Exception:  # noqa: BLE001
            continue
        if df.shape[1] > 1:
            df.columns = [str(c).strip().strip('"') for c in df.columns]
            return df
        best = df if best is None else best
    if best is None:
        raise ValueError("could not parse file as CSV/TSV/XLSX")
    return best
