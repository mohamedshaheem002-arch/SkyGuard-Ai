"""Global constants. Physical limits follow WMO-No. 8 / WMO-TD-1236 (Guidelines on QC of surface data)."""
from __future__ import annotations

SENSORS = ("temp", "pres", "rh")
SENSOR_LABEL = {"temp": "Temperature", "pres": "Pressure", "rh": "Relative humidity"}
SENSOR_UNIT = {"temp": "°C", "pres": "hPa", "rh": "%"}

# WMO plausible-value limits (gross error check)
WMO_LIMITS = {"temp": (-50.0, 60.0), "pres": (850.0, 1090.0), "rh": (0.0, 100.0)}
# Common fill / sentinel values seen in logger exports
FILL_VALUES = (-999.0, -99.9, -9999.0, 9999.0, 999.9, 99999.0, 65535.0, -32768.0)

# Sensor resolution (used for persistence / frozen test tolerance)
RESOLUTION = {"temp": 0.1, "pres": 0.1, "rh": 1.0}
# WMO operational accuracy tolerances (bias beyond this => maintenance)
TOLERANCE = {"temp": 0.5, "pres": 0.5, "rh": 5.0}

# Feature windows (hours)
LOOKBACK_H = 168          # ring buffer length per station
WIN_SHORT_H = 6
WIN_MED_H = 24
WIN_LONG_H = 72

# Spatial
MAX_NEIGHBOURS = 5
MAX_NEIGHBOUR_KM = 350.0
MIN_PAIR_SAMPLES = 120

# Decision thresholds (defaults; the trained model overrides theta)
THETA_FAULT = 0.5
THETA_UNCERTAIN = 0.25

VERDICTS = ("NORMAL", "SENSOR_FAULT", "GENUINE_WEATHER_EVENT", "DATA_COMM_ISSUE", "UNCERTAIN")
FAULT_CLASSES = ("normal", "spike", "frozen", "drift", "bias", "noise", "inconsistency")
HARD_CLASSES = ("out_of_range", "missing", "duplicate", "stale", "out_of_order")
