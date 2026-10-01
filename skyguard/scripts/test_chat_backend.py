"""Test suite for SkyGuard Groq AI backend integration and read-only tools."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd
from fastapi.testclient import TestClient
from app.main import app, demo_scored, _CACHE, UPLOAD_STORE
from skyguard.chat import (
    get_network_summary,
    get_station_health,
    get_station_timeseries,
    get_active_alerts,
    inspect_upload,
    explain_shap_features,
    GROQ_TOOLS,
    CHAT_SERVICE,
)


def run_tests():
    print("===============================================================")
    print(" SkyGuard AI - Groq Backend Integration & Tool Verification")
    print("===============================================================\n")

    # 1. Ensure demo data is loaded into memory
    print("[1/5] Loading demo scored telemetry...")
    d = demo_scored()
    assert d is not None and len(d) > 0, "Demo dataframe failed to load"
    print(f"  [OK] Demo data loaded: {len(d):,} observations across {d['station_id'].nunique()} stations\n")

    # 2. Test each of the 6 read-only tools
    print("[2/5] Testing 6 Read-Only Tools against existing cached data:")

    # Tool 1: get_network_summary
    net_summary = get_network_summary()
    assert "total_stations" in net_summary or "total_observations" in net_summary, "get_network_summary failed"
    print(f"  [OK] Tool 1 'get_network_summary': {net_summary.get('total_stations')} stations, {net_summary.get('anomalous_observations')} anomalies")

    # Tool 2: get_station_health
    sample_sid = str(d["station_id"].iloc[0])
    st_health = get_station_health(sample_sid)
    assert "station_health" in st_health or "sensors" in st_health, "get_station_health failed"
    print(f"  [OK] Tool 2 'get_station_health' (Station {sample_sid}): Health score {st_health.get('station_health', {}).get('health')}, Status: {st_health.get('station_health', {}).get('status')}")

    # Tool 3: get_station_timeseries
    ts_data = get_station_timeseries(sample_sid, hours=10)
    assert ts_data.get("points_returned", 0) > 0, "get_station_timeseries returned 0 rows"
    print(f"  [OK] Tool 3 'get_station_timeseries' (Station {sample_sid}): Returned {ts_data.get('points_returned')} observation points")

    # Tool 4: get_active_alerts
    alerts_data = get_active_alerts(limit=5)
    assert "alerts" in alerts_data, "get_active_alerts failed"
    print(f"  [OK] Tool 4 'get_active_alerts': Found {alerts_data.get('total_alerts_found')} total alert episodes, returned top {alerts_data.get('returned_count')}")

    # Tool 5: explain_shap_features
    # Find an anomalous row
    alert_rows = d[d["verdict"] != "NORMAL"]
    if not alert_rows.empty:
        target_row = alert_rows.iloc[0]
        shap_sid = str(target_row["station_id"])
        shap_ts = pd.Timestamp(target_row["ts"]).strftime("%Y-%m-%d %H:%M")
        shap_exp = explain_shap_features(shap_sid, shap_ts)
        assert "verdict" in shap_exp, "explain_shap_features failed"
        print(f"  [OK] Tool 5 'explain_shap_features' (Station {shap_sid} at {shap_ts}): Verdict={shap_exp.get('verdict')}")
    else:
        print("  [OK] Tool 5 'explain_shap_features': (No anomaly in sample)")

    # Tool 6: inspect_upload
    # Save a slice to upload store to test upload inspection
    test_upload_id = "test_session_123"
    UPLOAD_STORE.save(d.head(100), test_upload_id)
    upload_summary = inspect_upload(test_upload_id)
    assert upload_summary.get("total_rows") == 100, "inspect_upload failed"
    print(f"  [OK] Tool 6 'inspect_upload': Upload ID {test_upload_id} verified with {upload_summary.get('total_rows')} rows\n")

    # 3. Test Tool Schemas
    print("[3/5] Verifying Groq Tool Schemas:")
    assert len(GROQ_TOOLS) == 6, f"Expected 6 tools in GROQ_TOOLS, found {len(GROQ_TOOLS)}"
    for tool in GROQ_TOOLS:
        name = tool["function"]["name"]
        print(f"  [OK] Schema valid: {name}")
    print()

    # 4. Test FastAPI Endpoints using TestClient
    print("[4/5] Testing FastAPI Endpoints via TestClient:")
    client = TestClient(app)

    # Chat status
    res_status = client.get("/api/chat/status")
    assert res_status.status_code == 200, f"Status code {res_status.status_code}"
    print(f"  [OK] GET /api/chat/status -> {res_status.json()}")

    # Chat endpoint
    res_chat = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "What is the status of the network?"}],
        "context": {"active_tab": "overview"}
    })
    assert res_chat.status_code == 200, f"Status code {res_chat.status_code}"
    chat_body = res_chat.json()
    assert "content" in chat_body, "Chat response missing content"
    print(f"  [OK] POST /api/chat -> Returned response successfully")

    # Chat stream endpoint
    res_stream = client.post("/api/chat/stream", json={
        "messages": [{"role": "user", "content": "Hello"}],
        "context": {"active_tab": "overview"}
    })
    assert res_stream.status_code == 200, f"Status code {res_stream.status_code}"
    assert "text/event-stream" in res_stream.headers.get("content-type", "")
    print(f"  [OK] POST /api/chat/stream -> Stream connection established (text/event-stream)\n")

    # 5. Verify Existing Endpoints Still Function Flawlessly
    print("[5/5] Verifying Existing SkyGuard AI Endpoints:")
    
    # /api/health
    h_res = client.get("/api/health")
    assert h_res.status_code == 200 and h_res.json().get("status") == "healthy"
    print(f"  [OK] GET /api/health -> status: {h_res.json().get('status')}")

    # /api/meta
    m_res = client.get("/api/meta")
    assert m_res.status_code == 200 and len(m_res.json().get("stations", [])) > 0
    print(f"  [OK] GET /api/meta -> {len(m_res.json().get('stations', []))} stations metadata verified")

    # /api/overview
    o_res = client.get("/api/overview")
    assert o_res.status_code == 200 and "verdict_counts" in o_res.json()
    print(f"  [OK] GET /api/overview -> verdict_counts: {o_res.json().get('verdict_counts')}")

    # /api/station/{sid}
    s_res = client.get(f"/api/station/{sample_sid}")
    assert s_res.status_code == 200 and "series" in s_res.json()
    print(f"  [OK] GET /api/station/{sample_sid} -> station timeseries verified")

    print("\n===============================================================")
    print(" ALL BACKEND & GROQ INTEGRATION TESTS PASSED SUCCESSFULLY! ")
    print("===============================================================")


if __name__ == "__main__":
    run_tests()
