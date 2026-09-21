"""Verdict layer, plain-English explanation, corrected-value estimate, sensor health."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import SENSORS, SENSOR_LABEL, SENSOR_UNIT, TOLERANCE

SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
ACTIONS = {
    "spike": "Transient - no dispatch; auto-reject reading, keep monitoring.",
    "noise": "Check cable/shield & logger ADC; inspect if noise persists > 24 h.",
    "frozen": "Sensor stuck - inspect element/connector; likely replacement.",
    "drift": "Progressive calibration drift - schedule recalibration.",
    "bias": "Step offset - verify against travelling standard; recalibrate.",
    "inconsistency": "RH/T relationship broken - check RH element (wetting / contamination).",
    "missing": "Telemetry gap - check power, modem and GPRS/INSAT link.",
    "fill": "Logger emitting fill values - check firmware/config.",
    "stale": "Repeated packets - check logger clock / transmission buffer.",
    "out_of_range": "Physically impossible value - reject; check sensor & wiring.",
    "duplicate": "Duplicate timestamp - de-duplicate; check logger clock.",
}


def _sev_from_z(z: float) -> str:
    z = abs(z)
    return "CRITICAL" if z > 8 else "HIGH" if z > 5 else "MEDIUM" if z > 3 else "LOW"


def which_sensor(row: pd.Series, top_feats: list[tuple[str, float]] | None) -> str:
    """Attribute an alert to the most anomalous element using SHAP top features, else largest |z|."""
    from .features import sensor_of_feature
    votes = {s: 0.0 for s in SENSORS}
    if top_feats:
        for f, v in top_feats:
            s = sensor_of_feature(f)
            if s and v > 0:
                votes[s] += v
        if max(votes.values()) > 0:
            return max(votes, key=votes.get)
    for s in SENSORS:
        votes[s] = max(abs(float(row.get(f"{s}_cz", 0) or 0)), abs(float(row.get(f"{s}_sp_z", 0) or 0)), float(row.get(f"{s}_streak_r", 0) or 0))
    return max(votes, key=votes.get)


def corrected_value(row: pd.Series, sen: str) -> tuple[float | None, str, float]:
    """Blend spatial estimate (SRT), 24h persistence-of-bias and climatology. Returns (value, method, confidence)."""
    sp = row.get(f"{sen}_sp_est"); n = row.get(f"{sen}_sp_n", 0) or 0
    clim = row.get(f"{sen}_clim_med")
    ests, ws, tags = [], [], []
    if sp is not None and np.isfinite(sp) and n >= 2:
        ests.append(float(sp)); ws.append(min(n, 5) / 5 * 0.7); tags.append("neighbours")
    if clim is not None and np.isfinite(clim):
        ests.append(float(clim)); ws.append(0.2); tags.append("climatology")
    if not ests:
        return None, "none", 0.0
    val = float(np.average(ests, weights=ws))
    if sen == "rh":
        val = float(np.clip(val, 0, 100))
    conf = float(min(0.95, sum(ws)))
    return round(val, 1), "+".join(tags), conf


def verdict(row: pd.Series, p_fault: float, theta: float, hard: dict, rc_label: str | None, rc_conf: float,
            top_feats: list[tuple[str, float]] | None) -> dict:
    """Combine Tier-1 hard flags, ML probability, root cause and witness agreement into one decision."""
    out = {"verdict": "NORMAL", "severity": "LOW", "confidence": float(1 - p_fault), "fault": "normal",
           "sensor": None, "action": "No action.", "explanation": "All checks within normal bounds.",
           "corrected": None, "correction_method": None, "bias_estimate": None}
    # ---- Tier-1 hard evidence first (deterministic, always wins)
    if hard.get("all_missing"):
        out.update(verdict="DATA_COMM_ISSUE", fault="missing", sensor="all", severity="MEDIUM" if hard.get("gap_h", 1) < 6 else "HIGH",
                   confidence=1.0, action=ACTIONS["missing"],
                   explanation=f"No telemetry received ({hard.get('gap_h', 1):.0f} h gap). Communication or power failure.")
        return out
    if hard.get("any_fill"):
        s = hard.get("fill_sensor", "temp")
        out.update(verdict="DATA_COMM_ISSUE", fault="fill", sensor=s, severity="MEDIUM", confidence=1.0, action=ACTIONS["fill"],
                   explanation=f"{SENSOR_LABEL[s]} = {row.get(s)} is a logger fill/sentinel value, not a measurement.")
        return out
    if hard.get("any_oor"):
        s = hard.get("oor_sensor", "temp")
        out.update(verdict="SENSOR_FAULT", fault="out_of_range", sensor=s, severity="CRITICAL", confidence=1.0, action=ACTIONS["out_of_range"],
                   explanation=f"{SENSOR_LABEL[s]} = {row.get(s)} {SENSOR_UNIT[s]} is outside the WMO plausible range.")
        cv, m, _ = corrected_value(row, s); out.update(corrected=cv, correction_method=m)
        return out
    if hard.get("duplicate"):
        out.update(verdict="DATA_COMM_ISSUE", fault="duplicate", sensor="all", severity="LOW", confidence=1.0, action=ACTIONS["duplicate"],
                   explanation="Duplicate timestamp for this station.")
        return out
    if hard.get("stale"):
        out.update(verdict="DATA_COMM_ISSUE", fault="stale", sensor="all", severity="MEDIUM", confidence=0.95, action=ACTIONS["stale"],
                   explanation="Identical T/P/RH repeated for 4+ consecutive reports - logger re-sending the same packet.")
        return out
    if hard.get("td_gt_t"):
        out.update(verdict="SENSOR_FAULT", fault="inconsistency", sensor="rh", severity="HIGH", confidence=0.95, action=ACTIONS["inconsistency"],
                   explanation="Dew point exceeds air temperature - physically impossible T/RH pair.")
        return out

    # ---- WMO temporal-consistency gross-step test (deterministic; validated FA < 0.001 % on held-out normal hours)
    for s_ in SENSORS:
        stp = float(row.get(f"{s_}_step_z", np.nan)); c_ = float(row.get(f"{s_}_cz", np.nan))
        w_ = row.get(f"{s_}_witness", np.nan); w_ = float(w_) if w_ is not None and np.isfinite(w_) else 0.0
        sz_ = float(row.get(f"{s_}_sp_z", np.nan))
        if np.isfinite(stp) and abs(stp) >= 10 and np.isfinite(c_) and abs(c_) >= 6 and w_ < 0.5 and (not np.isfinite(sz_) or abs(sz_) >= 5):
            cv, method, _ = corrected_value(row, s_)
            out.update(verdict="SENSOR_FAULT", fault="spike", sensor=s_, severity="HIGH" if abs(c_) > 10 else "MEDIUM",
                       confidence=float(max(p_fault, 0.95)), action=ACTIONS["spike"], corrected=cv, correction_method=method,
                       explanation=f"{SENSOR_LABEL[s_]} SPIKE: jumped {stp:+.0f}× the station's typical hourly change and sits {c_:+.1f}σ from climatology"
                                   + (f"; {sz_:+.1f}σ vs neighbours" if np.isfinite(sz_) else "; no neighbour data (cold start)") + " - WMO temporal-consistency failure.")
            return out

    # ---- ML evidence
    sen = which_sensor(row, top_feats)
    cz = float(row.get(f"{sen}_cz", np.nan)); spz = float(row.get(f"{sen}_sp_z", np.nan)); wit = row.get(f"{sen}_witness", np.nan)
    nbn = int(row.get(f"{sen}_sp_n", 0) or 0)
    streak = float(row.get(f"{sen}_streak_h", 0) or 0)
    wit = float(wit) if wit is not None and np.isfinite(wit) else np.nan
    zmax = np.nanmax([abs(cz) if np.isfinite(cz) else 0, abs(spz) if np.isfinite(spz) else 0])

    if p_fault < theta:
        # not a fault - but is it a genuine extreme event worth telling the forecaster about?
        best = None
        for s_ in SENSORS:
            c_ = float(row.get(f"{s_}_cz", np.nan)); w_ = row.get(f"{s_}_witness", np.nan)
            w_ = float(w_) if w_ is not None and np.isfinite(w_) else np.nan
            n_ = int(row.get(f"{s_}_sp_n", 0) or 0)
            if np.isfinite(c_) and abs(c_) > 4.0 and np.isfinite(w_) and w_ >= 0.6 and n_ >= 2 and (best is None or abs(c_) > abs(best[1])):
                best = (s_, c_, w_, n_)
        if best is not None:
            sen, cz, wit, nbn = best
            out.update(verdict="GENUINE_WEATHER_EVENT", severity=_sev_from_z(cz), confidence=float(max(1 - p_fault, 0.5)), sensor=sen,
                       fault="normal", action="No maintenance. Flag to forecaster as a real event.",
                       explanation=f"{SENSOR_LABEL[sen]} is {cz:+.1f}σ from climatology but {int(round(wit * nbn))}/{nbn} neighbouring stations show the same anomaly - a real weather event, not a fault.")
        elif p_fault >= theta * 0.6:
            out.update(verdict="UNCERTAIN", severity="LOW", confidence=float(p_fault), sensor=sen, fault=rc_label or "unknown",
                       action="Monitor - re-evaluate with next readings.",
                       explanation=f"Weak fault evidence on {SENSOR_LABEL[sen].lower()} (p={p_fault:.2f}); not enough to alert.")
        return out

    # fault
    fault = rc_label or "unknown"
    sev = _sev_from_z(zmax)
    if fault in ("drift", "bias") and np.isfinite(spz):
        sev = "HIGH" if abs(spz) > 4 else "MEDIUM"
    if fault == "frozen":
        sev = "HIGH" if streak >= 12 else "MEDIUM"
        # persistence guard: a stuck value must outlast the station's natural repeat length unless the
        # neighbours already show the stuck value is wrong (|spatial z| >= 2). Stations that log whole
        # numbers repeat identical values for up to ~10 h naturally (validated on held-out 2025 data).
        coarse = bool((hard.get("coarse") or {}).get(sen, False))
        min_streak = 12 if coarse else 4   # whole-number loggers: persistence alone only counts after half a day (natural runs reach 9-10 h)
        if streak < min_streak and not (np.isfinite(spz) and abs(spz) >= 2.0):
            out.update(verdict="UNCERTAIN", severity="LOW", confidence=float(p_fault), sensor=sen, fault="frozen",
                       action="Monitor - re-evaluate with next readings.",
                       explanation=f"{SENSOR_LABEL[sen]} unchanged for {streak:.0f} h - still within the natural repeat length for this station"
                                   + (" (logger reports whole numbers)" if coarse else "")
                                   + f"; alert if it stays stuck for {min_streak} h or neighbours diverge.")
            return out
    if fault == "spike":
        sev = "MEDIUM" if zmax < 8 else "HIGH"
    if fault == "noise":
        sev = "MEDIUM"
    # genuine-weather override: strong ML score but ALL neighbours agree and no persistence/stuck evidence
    if np.isfinite(wit) and wit >= 0.75 and nbn >= 3 and fault in ("spike", "drift", "bias") and abs(cz) > 2.5 and abs(spz) < 2.5:
        out.update(verdict="GENUINE_WEATHER_EVENT", severity=_sev_from_z(cz), confidence=float(wit), sensor=sen, fault="normal",
                   action="No maintenance. Flag to forecaster as a real event.",
                   explanation=f"{SENSOR_LABEL[sen]} anomaly ({cz:+.1f}σ) is shared by {int(round(wit * nbn))}/{nbn} neighbours and matches the spatial estimate ({spz:+.1f}σ) - regional weather, not a sensor fault.")
        return out

    parts = []
    if np.isfinite(cz) and abs(cz) > 2:
        parts.append(f"{cz:+.1f}σ vs this station's {pd.Timestamp(row['ts']).strftime('%B %H:00') if 'ts' in row else ''} climatology")
    if np.isfinite(spz) and nbn > 0:
        parts.append(f"{spz:+.1f}σ vs the estimate from {nbn} neighbours" + (f" ({int(round(wit * nbn))}/{nbn} neighbours anomalous)" if np.isfinite(wit) else ""))
    if fault == "frozen" or streak >= 4:
        parts.append(f"value unchanged for {streak:.0f} h")
    if fault == "inconsistency":
        c = row.get("rh_t_corr12"); parts.append(f"12-h T/RH correlation {float(c):+.2f} (normally strongly negative)" if c is not None and np.isfinite(c) else "T/RH relationship broken")
    if fault == "noise":
        parts.append(f"6-h step volatility {float(row.get(f'{sen}_dstd6_r', 0)):.1f}× normal")
    if fault in ("drift", "bias"):
        cus = max(float(row.get(f"{sen}_cusum_pos", 0) or 0), float(row.get(f"{sen}_cusum_neg", 0) or 0)); parts.append(f"CUSUM {cus:.1f} (alarm > 5)")
    if top_feats:
        parts.append("top SHAP: " + ", ".join(f"{f} {v:+.2f}" for f, v in top_feats[:3]))
    cv, method, cconf = corrected_value(row, sen)
    bias = None
    if fault in ("drift", "bias") and cv is not None and np.isfinite(row.get(sen, np.nan)):
        b24 = row.get(f"{sen}_sp_bias_med24")
        bias = round(float(b24), 2) if b24 is not None and np.isfinite(b24) else round(float(row[sen]) - cv, 2)
    out.update(verdict="SENSOR_FAULT", fault=fault, sensor=sen, severity=sev, confidence=float(p_fault),
               action=ACTIONS.get(fault, "Inspect sensor."), corrected=cv, correction_method=method, bias_estimate=bias,
               explanation=f"{SENSOR_LABEL[sen]} {fault.upper()} (p={p_fault:.2f}, class conf {rc_conf:.2f}): " + "; ".join(parts) + ".")
    return out


# ------------------------------------------------------------------------------------------------ health
def health_from_history(hist: pd.DataFrame) -> dict:
    """hist: recent decisions for one station (last 7 days) with columns verdict, fault, sensor, severity, ts,
    plus feature cols *_sp_slope72_z / *_sp_bias_med24. Returns per-sensor health 0-100 and station status."""
    out = {}
    now = hist["ts"].max() if len(hist) else None
    for s in SENSORS:
        score = 100.0
        h = hist[(hist["sensor"] == s) | (hist["sensor"] == "all")]
        if len(hist):
            frac_fault = (h["verdict"] == "SENSOR_FAULT").sum() / max(len(hist), 1)
            frac_comm = (h["verdict"] == "DATA_COMM_ISSUE").sum() / max(len(hist), 1)
            score -= 250 * frac_fault + 80 * frac_comm
            sev_pen = {"LOW": 0.5, "MEDIUM": 2, "HIGH": 5, "CRITICAL": 10}
            recent = h[h["ts"] >= now - pd.Timedelta(hours=24)] if now is not None else h
            score -= sum(sev_pen.get(v, 0) for v in recent.loc[recent["verdict"] == "SENSOR_FAULT", "severity"])
            # persistent bias vs neighbours (last 24 h median residual) relative to WMO tolerance
            b = hist[f"{s}_sp_bias_med24"].dropna()
            bias = float(b.iloc[-1]) if len(b) else 0.0
            score -= 15 * min(abs(bias) / TOLERANCE[s], 3)
            slope = hist[f"{s}_sp_slope72_z"].dropna()
            slope = float(slope.iloc[-1]) if len(slope) else 0.0
        else:
            bias = slope = 0.0
        score = float(np.clip(score, 0, 100))
        status = "HEALTHY" if score >= 80 else "WATCH" if score >= 60 else "MAINTENANCE" if score >= 40 else "CRITICAL"
        days_to_breach = None
        if abs(slope) > 0.05:
            remaining = TOLERANCE[s] * 2 - abs(bias)   # heuristic: alarm at 2x tolerance
            unit_per_day = abs(slope) * TOLERANCE[s]   # slope is in z units/day; 1z ~ tolerance-scale
            if unit_per_day > 0 and remaining > 0:
                days_to_breach = round(remaining / unit_per_day, 1)
        out[s] = {"health": round(score, 1), "status": status, "bias_24h": round(bias, 2), "drift_slope_z_per_day": round(slope, 3),
                  "days_to_tolerance_breach": days_to_breach}
    worst = min(out.values(), key=lambda d: d["health"])
    out["station"] = {"health": worst["health"], "status": worst["status"]}
    return out
