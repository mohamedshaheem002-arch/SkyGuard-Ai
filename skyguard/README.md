# SkyGuard AI — Physics-informed, spatially-aware anomaly detection for AWS networks

**Smart India Hackathon 2026 · PS SIH26073 · Ministry of Earth Sciences / IMD**

SkyGuard AI decides, for every AWS report of temperature, pressure and humidity, whether it is
**NORMAL**, a **SENSOR_FAULT** (with root cause: spike · frozen · drift · bias · noise · inconsistency · out-of-range),
a **GENUINE_WEATHER_EVENT** (real extreme weather — do *not* send a technician), a **DATA_COMM_ISSUE**
(missing · fill values · stale packets · duplicates) or **UNCERTAIN** — with severity, confidence, a plain-English
SHAP-backed explanation, a corrected value, a bias estimate, and per-sensor health with maintenance action.

It is built on the methods national weather services actually run — WMO-TD 1236 QC tests, NOAA MADIS level 1-3
checks, the Hubbard **Spatial Regression Test** used by US regional climate centres, and CUSUM control charts —
combined with a LightGBM detector trained on **real hourly data from 43 Indian WMO stations** with injected faults.

## Quick start (laptop)
```bash
pip install -r requirements.txt
python run.py                # -> http://localhost:8000
```
The demo network (3-month held-out window, 43 stations, faults injected with ground truth) ships pre-scored, so the first page is instant.

Self-check (40 upload shapes: odd headers, Kelvin/Pa/°F, ; tab utf-16 xlsx, epoch/ISO/dd-mm dates, gaps, duplicates, sentinels, cold-start stations, injected faults, 16k-row file):
```bash
python scripts/stress_test.py     # prints one line per case, ends with ALL PASSED
```

Command line on any CSV:
```bash
python -m skyguard --input my_aws_data.csv --output scored.csv
```
Column names, units (°C/K/°F, hPa/Pa/inHg), cadence (1 min … 1 h) and unknown stations are handled automatically.

Docker / Hugging Face Space:
```bash
docker build -t skyguard . && docker run -p 7860:7860 skyguard
```

## Retrain from scratch (≈ 7 min, 2 GB RAM)
```bash
python scripts/prepare.py    # download Meteostat archive, inject faults, fit climatology + spatial model, features
python scripts/train.py      # LightGBM detector + root-cause, threshold on validation, metrics on test
```

## Architecture
```
reading ─► Tier 1 deterministic QC ─► 98-feature context engine ─► LightGBM detector + root-cause
            range · fill · dup · stale       climatology z · steps · CUSUM        p_fault, class
            dew-point ≤ T                    persistence · physics · SRT spatial
                                             witness agreement                 ─► verdict + severity + confidence
                                                                                  SHAP explanation · corrected value
                                                                                  bias estimate · health 0-100 · action
```
* `skyguard/qc.py` – Tier-1 rules · `skyguard/climatology.py` – station×month×hour robust baselines
* `skyguard/spatial.py` – Spatial Regression Test + witness score · `skyguard/features.py` – feature engine
* `skyguard/decision.py` – verdict, explanation, correction, health · `skyguard/engine.py` – end-to-end scorer
* `app/` – FastAPI + dashboard · `edge/skyguard_edge.ino` – ESP32 Tier-1 + CUSUM edge tier
* `docs/USE_CASES.md` – 11 worked use cases incl. the Mungeshpur 52.9 °C incident

## Benchmark (chronological hold-out, Jan–Jun 2025, 169k observations, 43 stations)
See the **Benchmarks** tab in the dashboard or `models/metrics.json`. Headline numbers: point precision ≈ 95 % at a
0.5 % false-alarm rate, ≈ 86 % of fault episodes detected (100 % of missing/fill/stale, ≈ 96 % frozen/drift/
inconsistency), root cause correct ≈ 85 % of the time given detection, and only ≈ 0.8 % false alarms on real
extreme-weather hours.

## Data
Meteostat bulk hourly archive (NOAA ISD / national SYNOP), stations selected in dense clusters (Delhi, Mumbai,
Chennai, Bengaluru, Kerala, Kolkata) plus hill stations. Faults are injected with ground truth; natural archive gaps
are counted as genuine missing telemetry. No IMD-internal data was used.
