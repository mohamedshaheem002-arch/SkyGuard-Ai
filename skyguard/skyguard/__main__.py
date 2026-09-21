"""CLI:  python -m skyguard --input any.csv --output scored.csv [--no-explain]"""
from __future__ import annotations

import argparse, json, sys
from pathlib import Path

import io
import pandas as pd
from .data import read_any_table

from .engine import SkyGuard


def main():
    ap = argparse.ArgumentParser(description="SkyGuard AI: score AWS observations (any CSV with time/station/T/P/RH columns)")
    ap.add_argument("--input", required=True); ap.add_argument("--output", default="skyguard_scored.csv")
    ap.add_argument("--no-explain", action="store_true", help="skip SHAP for speed")
    ap.add_argument("--models", default=str(Path(__file__).resolve().parents[1] / "models"))
    a = ap.parse_args()
    eng = SkyGuard(a.models)
    df = read_any_table(open(a.input, "rb").read())
    scored, rep = eng.score_frame(df, explain=not a.no_explain)
    cols = ["station_id", "ts", "temp", "pres", "rh", "verdict", "fault", "sensor", "severity", "confidence", "p_fault",
            "corrected", "bias_estimate", "temp_expected", "pres_expected", "rh_expected", "explanation", "action"]
    scored[cols].to_csv(a.output, index=False)
    health = eng.station_health(scored)
    print(json.dumps({"report": rep, "health": health}, indent=2, default=str))
    print(f"\nwrote {a.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
