# SkyGuard AI — status: WORKING PROTOTYPE (13 Sep 2026)

Run:  pip install -r requirements.txt && python run.py  -> http://localhost:8000
CLI:  python -m skyguard --input any.csv --output scored.csv
Retrain: python scripts/prepare.py && python scripts/train.py  (~7 min, 2 GB RAM)

Done: data (43 real Indian WMO stations), injector, Tier-1 QC, climatology, Spatial Regression Test,
104 features, LightGBM detector + root-cause, verdict layer, SHAP explanations, corrected values, health,
FastAPI + dashboard (network map, station charts, judge-mode CSV upload, benchmarks), ESP32 sketch,
README, USE_CASES.md, Dockerfile.

Known limits / next ideas: small pure step-biases (< ~4 °C) at a single station are only caught after
they persist (the spatial CUSUM); noise class recall is low (~60 % of episodes); LSTM not used by design.


## 2026-09-13 late: deterministic gross-step spike guard
- decision.py now applies a WMO temporal-consistency test before ML: |step_z|>=10 & |cz|>=6 & witness<0.5 & (no neighbours OR |sp_z|>=5) -> SENSOR_FAULT/spike. Validated: <0.001 % FA on held-out normal hours; catches single-station cold-start spikes (e.g. 58 °C at 15-min cadence with no neighbours) that the tree model extrapolated poorly on.
- __main__.py sniffs CSV delimiter (sep=None).
- demo_scored.parquet rebuilt with the new rule (SENSOR_FAULT 9,992 / UNCERTAIN 3,958; everything else unchanged).


## 2026-09-14: UI redesign (frontend only)
- `app/static/index.html` rewritten around the judge flow: Overview (status map + counts + needs-attention) · All Stations (compact table: name, ID, T, P, RH, status colour, confidence) · Station detail (readings, FINAL VERDICT banner, one chart with Temperature|Pressure|Humidity tabs, anomaly list, WHY THIS RESULT? panel with spatial σ / neighbour agreement / climatology σ / CUSUM + plain-English sentence, top-5 SHAP bars in plain words, SENSOR RESULT box only when a sensor fault is selected, compact SENSOR HEALTH) · Test / Upload (drop zone + LOAD DEMO SAMPLE + summary counts + same detail panel) · Alerts · Benchmarks.
- Removed from view: KPI cards, big health table, three simultaneous charts, feature counts/θ in header, CUSUM/drift numbers, TP/FP debug, How-it-works page (content lives in README).
- Backend: ONE additive change - `/api/overview` now also returns `latest` (each station's most recent scored row) so All Stations renders instantly. No scoring/model/API-shape changes otherwise.
- Verified with Playwright: all 5 nav pages + detail flow + demo sample + messy upload + bad-file error, zero JS errors.

## 2026-09-14: debug sweep
- Static: all modules compile, pyflakes clean, JS syntax OK.
- Engine edge cases (empty, 1 row, all-NaN, duplicates, unsorted, mixed cadence, extreme values, Kelvin/Pa, epoch ts, 50 stations, NaN station ids): fixed crash on NaN/blank station id (now "UNKNOWN"), empty file now gives a clean 400 message, removed dead code in register_unseen.
- New `skyguard.data.read_any_table` shared by API + CLI: xlsx, UTF-8/16, BOM, quoted fields with spaces, any delimiter.
- API fuzz: 40 cases incl. bad params, wrong multipart field, oversize, concurrency (16 parallel) — all return proper codes, no 500s, no NaN in JSON.
- Frontend: all 43 stations, zero-anomaly station, rapid window/tab switching, nav loop, filter, upload/bad-file/demo-again/xlsx, all anomaly rows, alerts→station, 1024/1920 px: no JS errors, no text leaks; added <900 px responsive rules.
- run.py accepts a port argument; warnings silenced in server output.

## 2026-09-14 b: sample tests + wording fixes
- docs/sample_tests/: 3 verified judge files (normal / sensor fault / genuine weather) + README with expected results.
- UI text: neighbour-agreement phrasing now matches the numbers (k/n or witness %), bias/drift explained as one calibration-offset family with estimated offset, weather-event cause label 'Regional weather (neighbours agree)', UNCERTAIN/weather SHAP box explains why no attribution, health rows show persistent offset vs neighbours when that is what lowers the score, known station ids show their IMD name in upload mode.

## 2026-09-15 — rename + anomaly audit + persistence guard
- Renamed SkyGuard-X -> SkyGuard AI everywhere (app title, header logo, README, docs, edge sketch, CLI).
- Audited every non-NORMAL row of the demo network against injected ground truth (data/demo_scored.parquet):
  19.2 % of demo rows are injected faults + 3.7 % natural archive gaps BY DESIGN (PS evaluates on anomaly-injected data),
  so the large number of alerts is intended. Of 17,812 hard alerts 96.2 % were true; false alarms 0.81 % of clean rows,
  dominated by 'frozen' / 'stale' at stations whose loggers report whole-number T/P (42071, 42181, 42369, 43279, 42348,
  43296 ...) which naturally repeat identical values for up to 9-10 h.
- FIX (skyguard/qc.py, engine.py, decision.py): `integer_resolution()` detects whole-number loggers per station;
  stale rule needs 4 identical reports there (3 elsewhere); frozen verdict needs a run >= 12 h at such stations
  (>= 4 h elsewhere) unless neighbours already disagree (|spatial z| >= 2) -> otherwise UNCERTAIN "persistence guard".
  Sample files unchanged (1: 1339 N/5 UNC; 2: 1214 N/119 SF/11 UNC; 3: 1228 N/101 GWE/11 UNC/4 COMM).
- UI: plain-English text + SHAP-box note for the persistence-guard UNCERTAIN case.
- demo_scored.parquet + demo_report.json regenerated with the new rules (backup of old at /home/user/demo_scored_backup.parquet).
- NOTE: workspace snapshot is capped ~128 MB. data_cache/ (57 MB Meteostat raw downloads, auto re-downloaded when needed) and
  the demo backup parquet were removed from the workspace so the zip persists. Current zip: skyguard_ai_prototype_v4_2026-09-15.zip

## 2026-09-15 b — Alerts/Overview mismatch + stress-test sweep (40 cases, scripts/stress_test.py)
- Alerts page showed every non-normal ROW of the last hours (hundreds of lines) while the Overview shows only the
  CURRENT verdict per station -> looked contradictory. `/api/overview.recent_alerts` now returns alert EPISODES
  (consecutive same station/verdict/cause rows collapsed: start -> end, hours, worst severity) with an `active`
  flag (= still present at the station's latest reading = exactly the Overview state). Alerts table shows
  "ACTIVE / ended hh:mm" first column and a one-line summary "N active now · M cleared in the last 7 days".
- BUG: 999.9 hPa (a real pressure) was treated as a sentinel -> 137 false "fill" comm alerts. Fill values now must
  also be outside the sensor's physical range (qc.py + data.py). Pressure exactly 0 is now a fill (was out_of_range).
- BUG: a station that stops reporting before the end of a multi-station file was silently truncated instead of
  flagged -> `regularise()` now pads every station to the network's latest timestamp (tail = DATA_COMM_ISSUE missing).
- BUG: cold-start (unknown) stations kept the climatology fitted from the FIRST upload -> now re-fitted per file.
- BUG: cold-start climatology from a one-week file was far too tight (sigma from 7 days) -> false GWE/UNCERTAIN;
  MAD is now floored at the network-typical spread when history < 60 days. Clean cold-start file: 1344/1344 NORMAL.
- demo_scored() re-scores from data/obs.parquet true values when the raw archive cache is absent (offline-safe).
- Demo network re-scored: false alarms 0.64 % -> 0.52 % of clean rows; hard-alert precision 97.5 %.
- Stress test: 40 cases (odd headers, Kelvin/Pa/°F/RH-fraction, ; tab utf-16 xlsx, epoch/ISO/dd-mm timestamps,
  shuffled rows, duplicates, gaps, sentinels, NaN, garbage, 1 row, 10-min & 3-h cadence, cold start ± lat/lon,
  7 injected fault kinds, 16k rows/96 unknown stations in 22 s) -> ALL PASSED.
