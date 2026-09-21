SkyGuard AI — sample test files (PS SIH26073)
============================================
All three files are REAL hourly observations from 8 IMD/WMO stations around Delhi
(Safdarjung, Palam, Agra, Bareilly, Jaipur, Chandigarh, Gwalior, Amritsar), 2025 —
a period the model never saw in training. Columns:
  station_id, station_name, timestamp (UTC), temperature_c, pressure_hpa, humidity_pct

How to test: open the dashboard -> "Test / Upload" -> drop the file (or run
  python -m skyguard --input <file> --output scored.csv).

1_normal_delhi_network.csv          20–26 Feb 2025, 1,344 rows, NOTHING injected.
   Expected result: ~99.6 % NORMAL, a handful of UNCERTAIN, no SENSOR FAULT,
   no GENUINE WEATHER EVENT. (Verified: NORMAL 1,339 / UNCERTAIN 5.)

2_sensor_fault_delhi_network.csv    same week, THREE faults injected:
   a) New Delhi Safdarjung  temperature +7 °C calibration bias from 23 Feb 06:00
      (the "Mungeshpur 52.9 °C" scenario: only one station is hot, neighbours are not)
   b) Jaipur                humidity sensor frozen 24 Feb 00:00 -> 25 Feb 11:00 (36 h)
   c) Agra                  single 55 °C temperature spike at 22 Feb 14:00
   Expected result: SENSOR FAULT at those three stations only.
   (Verified: Safdarjung 86/90 h flagged as bias/drift, first alarm 1 h after onset,
    estimated bias +6.4 °C, corrected value within ~1 °C of the true reading;
    Jaipur 32/36 h flagged frozen, first alarm 4 h after onset; Agra spike caught;
    0 false alarms at the five untouched stations.)

3_weather_event_delhi_premonsoon_low.csv   25–31 May 2025, NOTHING injected.
   A real pre-monsoon low-pressure system + thunderstorms crossed the region on
   28–30 May: pressure 4–6 sigma below climatology at EVERY station at once.
   Expected result: GENUINE WEATHER EVENT (orange), not SENSOR FAULT — the
   "Why this result?" panel shows neighbour agreement 5/5.
   (Verified: 101 GENUINE WEATHER EVENT rows, mostly 29–30 May; the four real
    999.9 hPa readings in the archive are correctly accepted as normal; a few short
    identical-pressure runs at whole-number loggers (Amritsar, Palam, Jaipur)
    are held as UNCERTAIN by the persistence guard, not raised as faults.)

Tip for the demo: upload file 2, click the Safdarjung bias row -> the Sensor Result
box shows Observed / Estimated bias / Corrected estimate; then upload file 3 and
click a Jaipur pressure row -> same magnitude of deviation, opposite verdict,
because the neighbours agree.
