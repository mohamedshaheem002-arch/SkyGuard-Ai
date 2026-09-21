# SkyGuard AI — Use Cases

Each case lists the input pattern, what the engine sees, and the verdict it produces. All are reproducible with
`python -m skyguard --input <csv>` or by uploading the CSV under **Test / Upload** on the dashboard (or pressing **LOAD DEMO SAMPLE**).

## 1. Mungeshpur, Delhi — 29 May 2024 (real incident)
**What happened.** The Mungeshpur AWS reported 52.9 °C. IMD's investigation found a ~3 °C positive sensor bias
(corrected ≈ 49.9 °C); 14 of Delhi's 20 stations read 45–50 °C. The value was inside the WMO plausible range, so a
range check could never have caught it.
**What SkyGuard AI sees.** Climatology z ≈ +2.5σ (a hot day, but May in Delhi is hot); *spatial* z vs the estimate from
5 neighbours ≈ +3σ every hour; witness agreement 0/4 (neighbours are *not* anomalous relative to their own
climatology); spatial CUSUM climbs past its alarm level within a day; 24-h median offset vs neighbours ≈ +3 °C.
**Verdict.** `SENSOR_FAULT / bias`, severity HIGH, bias estimate ≈ +3 °C, corrected value ≈ neighbour estimate,
action *"verify against travelling standard; recalibrate"*. Exactly the conclusion IMD reached after a multi-day
committee — produced automatically.

## 2. Frozen humidity element after monsoon wetting
RH sticks at one value (often 100 % or the last reading) while temperature keeps its diurnal cycle.
**Seen.** `rh_streak_h` grows past the station's natural 99th-percentile run length; `rh_stuck_t_moving` is large;
dew point tracks T instead of staying flat; T/RH 12-h correlation collapses.
**Verdict.** `SENSOR_FAULT / frozen` after 3–4 h (median time-to-detect 4 h in the benchmark), severity HIGH once > 12 h.

## 3. Pre-monsoon thunderstorm (genuine event — must NOT alarm)
T drops 8 °C in an hour, RH jumps 40 %, pressure dips 3 hPa.
**Seen.** Big step-z and climatology-z — but the same anomaly appears at ≥ 60 % of neighbours (witness ≥ 0.6) and the
spatial z stays small because the neighbours moved too.
**Verdict.** `GENUINE_WEATHER_EVENT` (or NORMAL). Benchmark: 0.8 % false-alarm rate on 8,384 real extreme-weather
hours vs 0.5 % on ordinary hours.

## 4. Cyclone approach on the east coast
Sustained pressure fall of 10–20 hPa over 24 h at Chennai, Puducherry and Vellore together.
**Seen.** `pres_tend3` strongly negative at all stations; `pres_tend3_minus_nb` ≈ 0; witness ≈ 1.0.
**Verdict.** `GENUINE_WEATHER_EVENT` — flagged to the forecaster, no technician dispatched.

## 5. Lightning-induced single-sample spike
One reading of 55 °C between two normal readings.
**Seen.** step-z ≫ 6, acceleration flips sign next hour, spatial z ≫ 3, neighbours normal.
**Verdict.** `SENSOR_FAULT / spike`, severity MEDIUM, action *"auto-reject reading, keep monitoring"*, corrected value
from neighbours ⊕ climatology. Health barely moves — one spike is not a dying sensor.

## 6. GPRS dropout followed by duplicate packets
6 hours with no rows, then the buffer flushes the same timestamp twice.
**Seen.** Rows re-gridded → explicit gaps (`gap_h` counts up); duplicates detected on (station, timestamp).
**Verdict.** `DATA_COMM_ISSUE / missing` (HIGH after 6 h) then `DATA_COMM_ISSUE / duplicate` (LOW).

## 7. Slow pressure drift (−0.2 hPa/day for 3 weeks)
**Seen.** Point-wise the error is inside tolerance for days; the climatology CUSUM and spatial CUSUM accumulate;
`pres_sp_slope72_z` is steadily negative; the health panel's *days to tolerance breach* counts down.
**Verdict.** `SENSOR_FAULT / drift` (median time-to-detect ≈ 2 days in the benchmark, i.e. long before the 0.5 hPa
tolerance is exceeded), action *"schedule recalibration"*.

## 8. Himalayan station at −30 °C in January (must NOT alarm)
**Seen.** Climatology is per station × month × hour, so −30 °C at Srinagar in January has z ≈ 0.
**Verdict.** `NORMAL`. A global threshold model would flag this every night.

## 9. Brand-new station, no history (cold start)
A CSV arrives with a station ID the model has never seen, 15-minute cadence, columns named `Air Temp (K)`,
`Pressure (Pa)`, `Humidity`.
**Seen.** Schema normaliser maps the columns and converts K→°C and Pa→hPa; cadence auto-detected; a local robust
climatology is fitted from the file itself; if coordinates are present the station is linked to the nearest known
stations with lapse-rate/elevation priors.
**Verdict.** Full pipeline runs; confidence is naturally lower for the first days; the run report lists the station
under *unseen stations (cold-start)*.

## 10. Logger emitting fill values
Temperature column shows −999 for three rows after a firmware reset.
**Seen.** Tier-1 fill check (−999, 9999, 999.9, 0 % RH, …).
**Verdict.** `DATA_COMM_ISSUE / fill`, severity MEDIUM, values excluded from all rolling statistics so they cannot
poison later checks.

## 11. RH element reporting 12 h late (cross-talk / buffer bug)
RH rises *with* temperature during the day.
**Seen.** T/RH 12-h correlation turns positive (normally strongly negative); dew-point stability ratio breaks;
`td_cz` large.
**Verdict.** `SENSOR_FAULT / inconsistency` (96 % of episodes detected, median TTD 5 h).
