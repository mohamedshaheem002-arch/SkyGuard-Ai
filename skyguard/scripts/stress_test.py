"""Stress test: feed the engine many data shapes a judge could upload and check nothing crashes and the
verdicts make sense. Run:  python scripts/stress_test.py   (prints one line per case, exit code 1 on failure)."""
from __future__ import annotations
import io, sys, time, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from skyguard.engine import SkyGuard          # noqa: E402
from skyguard.data import read_any_table      # noqa: E402

E = SkyGuard()
BASE = pd.read_csv(ROOT / "docs" / "sample_tests" / "1_normal_delhi_network.csv")
FAULT = pd.read_csv(ROOT / "docs" / "sample_tests" / "2_sensor_fault_delhi_network.csv")
fails = []


def run(name, df_or_bytes, expect=None, must_raise=False):
    t = time.time()
    try:
        df = read_any_table(df_or_bytes) if isinstance(df_or_bytes, (bytes, bytearray)) else df_or_bytes
        out, rep = E.score_frame(df)
        vc = out["verdict"].value_counts().to_dict()
        ok = not must_raise and (expect is None or expect(out, rep))
        print(f"{'OK ' if ok else 'BAD'} {name:<46} {time.time()-t:5.1f}s rows={len(out):>6} {vc}")
        if not ok: fails.append(name)
        return out, rep
    except Exception as e:  # noqa: BLE001
        ok = must_raise
        print(f"{'OK ' if ok else 'BAD'} {name:<46} {time.time()-t:5.1f}s raised {type(e).__name__}: {str(e)[:90]}")
        if not ok: fails.append(name)
        return None, None


def to_csv(df, **kw): return df.to_csv(index=False, **kw).encode()


n_alerts = lambda out: int((out["verdict"] != "NORMAL").sum())
frac_normal = lambda out: float((out["verdict"] == "NORMAL").mean())

# 1. baselines
run("clean network (csv bytes)", to_csv(BASE), lambda o, r: frac_normal(o) > 0.99)
run("fault network", to_csv(FAULT), lambda o, r: (o["verdict"] == "SENSOR_FAULT").sum() >= 100)

# 2. schema / format robustness
odd = BASE.rename(columns={"station_id": "AWS ID", "station_name": "Site", "timestamp": "Date Time", "temperature_c": "Air Temp (K)",
                           "pressure_hpa": "Pressure (Pa)", "humidity_pct": "Humidity"})
odd["Air Temp (K)"] = (odd["Air Temp (K)"] + 273.15).round(2); odd["Pressure (Pa)"] = (odd["Pressure (Pa)"] * 100).round(0)
odd["Date Time"] = pd.to_datetime(odd["Date Time"]).dt.strftime("%d/%m/%Y %H:%M")
run("odd names + Kelvin + Pa + dd/mm/yyyy", to_csv(odd), lambda o, r: frac_normal(o) > 0.98 and "temperature Kelvin -> °C" in r["schema"]["notes"])
run("semicolon delimiter", to_csv(BASE, sep=";"), lambda o, r: frac_normal(o) > 0.99)
run("tab delimiter", to_csv(BASE, sep="\t"), lambda o, r: frac_normal(o) > 0.99)
run("utf-16 with BOM", BASE.to_csv(index=False).encode("utf-16"), lambda o, r: frac_normal(o) > 0.99)
xl = io.BytesIO(); BASE.to_excel(xl, index=False); run("xlsx upload", xl.getvalue(), lambda o, r: frac_normal(o) > 0.99)
epoch = BASE.copy(); epoch["timestamp"] = (pd.to_datetime(epoch["timestamp"]).astype("int64") // 10**9)
run("epoch-seconds timestamps", to_csv(epoch), lambda o, r: frac_normal(o) > 0.99)
iso = BASE.copy(); iso["timestamp"] = pd.to_datetime(iso["timestamp"]).dt.strftime("%Y-%m-%dT%H:%M:%SZ")
run("ISO-8601 Z timestamps", to_csv(iso), lambda o, r: frac_normal(o) > 0.99)
frac = BASE.copy(); frac["humidity_pct"] = frac["humidity_pct"] / 100
run("RH as fraction 0-1", to_csv(frac), lambda o, r: frac_normal(o) > 0.98)
fahr = BASE.copy(); fahr["temperature_c"] = fahr["temperature_c"] * 9 / 5 + 32
run("temperature in Fahrenheit", to_csv(fahr), lambda o, r: frac_normal(o) > 0.98)
single = BASE[BASE.station_id == 42182].drop(columns=["station_id", "station_name"])
run("single station, no station column", to_csv(single), lambda o, r: frac_normal(o) > 0.97)
shuffled = BASE.sample(frac=1, random_state=1)
run("rows shuffled (unsorted time)", to_csv(shuffled), lambda o, r: frac_normal(o) > 0.99)
dup = pd.concat([BASE, BASE.head(200)])
run("200 duplicate rows", to_csv(dup), lambda o, r: r["duplicates"] == 200 and (o["fault"] == "duplicate").sum() == 200)
gaps = BASE.drop(BASE.index[900:905]).drop(BASE.index[330:336])        # 5-h hole at Jaipur + Palam silent for its last 6 h
run("missing rows (gap + silent tail)", to_csv(gaps), lambda o, r: (o["fault"] == "missing").sum() == 11 and o[o.station_id == "42181"]["verdict"].iloc[-1] == "DATA_COMM_ISSUE")
sent = BASE.copy(); sent.loc[sent.index[50:56], "temperature_c"] = -999; sent.loc[sent.index[70:72], "pressure_hpa"] = 9999
run("-999 / 9999 sentinels", to_csv(sent), lambda o, r: 7 <= (o["fault"] == "fill").sum() <= 8)
real = BASE.copy(); real.loc[real.index[100:110], "pressure_hpa"] = 999.9
run("pressure exactly 999.9 hPa (real value)", to_csv(real), lambda o, r: (o["fault"] == "fill").sum() == 0)
nan_rows = BASE.copy(); nan_rows.loc[nan_rows.index[200:230], ["temperature_c", "pressure_hpa", "humidity_pct"]] = np.nan
run("30 rows all-NaN sensors", to_csv(nan_rows), lambda o, r: (o["fault"] == "missing").sum() >= 30)
txt = BASE.copy(); txt["temperature_c"] = txt["temperature_c"].astype(str); txt.loc[txt.index[10:13], "temperature_c"] = "n/a"
run("text garbage in numeric column", to_csv(txt), lambda o, r: frac_normal(o) > 0.97)
run("header only, no rows", b"station_id,timestamp,temperature_c,pressure_hpa,humidity_pct\n", must_raise=True)
run("random garbage bytes", bytes(range(256)) * 20, must_raise=True)
run("wrong columns (no T/P/RH)", b"a,b,c\n1,2,3\n4,5,6\n", must_raise=True)
one = BASE.head(1); run("one single row", to_csv(one), lambda o, r: len(o) == 1)
few = BASE[BASE.station_id == 42182].head(5); run("five rows one station", to_csv(few), lambda o, r: len(o) == 5)

# 3. cadence
m10 = BASE[BASE.station_id == 42182].copy(); m10["timestamp"] = pd.date_range("2025-02-20", periods=len(m10), freq="10min")
run("10-minute cadence", to_csv(m10), lambda o, r: abs(r["cadence_h"] - 1 / 6) < 1e-6 and frac_normal(o) > 0.9)
d3 = BASE.iloc[::3].copy(); run("3-hourly cadence", to_csv(d3), lambda o, r: r["cadence_h"] == 3 and frac_normal(o) > 0.95)

# 4. unknown stations (cold start), with and without coordinates
cold = BASE.copy(); cold["station_id"] = "AWS_" + cold["station_id"].astype(str)
run("all stations unknown (cold start)", to_csv(cold), lambda o, r: len(r["unseen_stations"]) == 8 and frac_normal(o) > 0.95)
coord = cold.copy(); ll = {"42182": (28.58, 77.2), "42181": (28.57, 77.12), "42260": (27.16, 77.96), "42348": (26.82, 75.8), "42189": (28.92, 78.07),
                          "42361": (27.5, 77.67), "42105": (29.47, 77.7), "42369": (26.75, 80.88)}
coord["lat"] = coord.station_id.str[4:].map(lambda k: ll.get(k, (28, 77))[0]); coord["lon"] = coord.station_id.str[4:].map(lambda k: ll.get(k, (28, 77))[1])
run("unknown stations WITH lat/lon", to_csv(coord), lambda o, r: frac_normal(o) > 0.95)
cold_f = FAULT.copy(); cold_f["station_id"] = "AWS_" + cold_f["station_id"].astype(str)
run("fault file, all stations unknown", to_csv(cold_f), lambda o, r: (o["verdict"] == "SENSOR_FAULT").sum() >= 20)
# same unknown station uploaded twice must give the same answer (no state leak)
o1, _ = run("cold-start repeat #1", to_csv(cold.head(600)), lambda o, r: True)
o2, _ = run("cold-start repeat #2 (identical)", to_csv(cold.head(600)), lambda o, r: o1 is not None and (o["verdict"].values == o1["verdict"].values).all())

# 5. injected anomalies on the clean file - is each caught, is the clean part still clean?
def inj(kind):
    x = BASE.copy(); m = x.station_id == 42348; idx = x.index[m][60:96]
    if kind == "spike": x.loc[idx[:1], "temperature_c"] = 55
    if kind == "frozen": x.loc[idx, "humidity_pct"] = x.loc[idx[0], "humidity_pct"]
    if kind == "bias": x.loc[x.index[m][60:], "temperature_c"] += 8
    if kind == "noise": x.loc[idx, "pressure_hpa"] += np.random.default_rng(0).normal(0, 6, len(idx))
    if kind == "oor": x.loc[idx[:3], "humidity_pct"] = 140
    if kind == "stale": x.loc[idx[:8], ["temperature_c", "pressure_hpa", "humidity_pct"]] = x.loc[idx[0], ["temperature_c", "pressure_hpa", "humidity_pct"]].values
    if kind == "dropout": x = x.drop(idx)
    return x
for kind, chk in [("spike", lambda o: (o["fault"] == "spike").sum() >= 1), ("frozen", lambda o: (o["fault"] == "frozen").sum() >= 10),
                  ("bias", lambda o: (o["verdict"] == "SENSOR_FAULT").sum() >= 20), ("noise", lambda o: (o["verdict"] == "SENSOR_FAULT").sum() >= 3),
                  ("oor", lambda o: (o["fault"] == "out_of_range").sum() == 3), ("stale", lambda o: (o["fault"] == "stale").sum() >= 4),
                  ("dropout", lambda o: (o["fault"] == "missing").sum() == 36)]:
    run(f"injected {kind} at Jaipur", to_csv(inj(kind)), lambda o, r, chk=chk: chk(o) and (o[o.station_id != "42348"]["verdict"] == "NORMAL").mean() > 0.98)

# 6. big file - time budget
big = pd.concat([BASE.assign(station_id=BASE.station_id.astype(str) + f"_{k}") for k in range(12)])   # 16k rows, 96 cold-start stations
run("16k rows / 96 unknown stations (<60 s)", to_csv(big), lambda o, r: r["seconds"] < 60)

print("\nFAILED:" if fails else "\nALL PASSED", fails)
sys.exit(1 if fails else 0)
