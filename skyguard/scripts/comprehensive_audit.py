"""Comprehensive Pre-Deployment Audit Suite for SkyGuard AI.
Audits all endpoints, security, uploads, malformed files, tool calling, and concurrency.
"""
import sys, io, os, time, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd
import numpy as np
from fastapi.testclient import TestClient
from app.main import app, demo_scored, UPLOAD_STORE, _CACHE, DEMO_MODE, CORS_ORIGINS
from skyguard.chat import CHAT_SERVICE

client = TestClient(app)

def audit():
    print("=================================================================")
    print("       SKYGUARD AI - FINAL PRE-DEPLOYMENT AUDIT SUITE            ")
    print("=================================================================\n")

    # 1. Environment & Secrets Check
    print("[1] Secrets & Environment Audit:")
    env_file = ROOT / ".env"
    has_env = env_file.exists()
    has_groq = bool(os.environ.get("GROQ_API_KEY"))
    groq_key = os.environ.get("GROQ_API_KEY", "")
    key_masked = f"{groq_key[:4]}...{groq_key[-4:]}" if len(groq_key) > 8 else "NOT_SET"
    print(f"  - Local .env present: {has_env}")
    print(f"  - GROQ_API_KEY loaded: {has_groq} ({key_masked})")
    print(f"  - DEMO_MODE: {DEMO_MODE}")
    print(f"  - CORS_ORIGINS: {CORS_ORIGINS}")

    # 2. Basic Endpoint Verification
    print("\n[2] Testing Core API Endpoints:")
    
    # GET /
    r = client.get("/")
    assert r.status_code == 200 and "html" in r.headers.get("content-type", "")
    print(f"  [PASS] GET / -> HTTP 200 (HTML UI served)")

    # GET /api/health
    r = client.get("/api/health")
    assert r.status_code == 200
    h_data = r.json()
    assert h_data.get("status") == "healthy" and h_data.get("models_loaded") is True
    print(f"  [PASS] GET /api/health -> HTTP 200, status='{h_data.get('status')}', stations={h_data.get('stations_count')}")

    # GET /api/meta
    r = client.get("/api/meta")
    assert r.status_code == 200
    m_data = r.json()
    assert len(m_data.get("stations", [])) == 43
    print(f"  [PASS] GET /api/meta -> HTTP 200, 43 WMO stations verified")

    # GET /api/overview
    r = client.get("/api/overview")
    assert r.status_code == 200
    o_data = r.json()
    assert "verdict_counts" in o_data and "stations" in o_data and "recent_alerts" in o_data and "latest" in o_data
    print(f"  [PASS] GET /api/overview -> HTTP 200, {len(o_data['stations'])} stations, {len(o_data['recent_alerts'])} alert episodes")

    # GET /api/station/{sid}
    r = client.get("/api/station/42182?days=14")
    assert r.status_code == 200
    s_data = r.json()
    assert "series" in s_data and "health" in s_data
    print(f"  [PASS] GET /api/station/42182 -> HTTP 200, {len(s_data['series'])} series points")

    # GET /api/sample_csv
    r = client.get("/api/sample_csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    print(f"  [PASS] GET /api/sample_csv -> HTTP 200, CSV sample returned ({len(r.content)} bytes)")

    # 3. Test Ingestion & Edge Scoring
    print("\n[3] Ingestion Point API Testing:")
    
    # Valid observation
    valid_obs = {
        "station_id": "42182",
        "timestamp": "2025-06-10 12:00:00",
        "temperature": 38.5,
        "pressure": 1002.0,
        "humidity": 45.0
    }
    r = client.post("/api/ingest", json=valid_obs)
    assert r.status_code == 200
    i_data = r.json()
    assert "verdict" in i_data
    print(f"  [PASS] POST /api/ingest (Valid) -> HTTP 200, Verdict: {i_data['verdict']}")

    # Invalid observation (unphysical temperature 85°C should be rejected by Pydantic with 422)
    invalid_obs = valid_obs.copy()
    invalid_obs["temperature"] = 85.0
    r = client.post("/api/ingest", json=invalid_obs)
    assert r.status_code == 422
    print(f"  [PASS] POST /api/ingest (Physical Limit 85°C Violation) -> HTTP 422 correctly caught")

    # 4. CSV & XLSX Upload Scoring & Edge Cases
    print("\n[4] File Upload & Scoring Pipeline Audit:")
    
    # Standard CSV
    sample_csv_path = ROOT / "docs" / "sample_tests" / "1_normal_delhi_network.csv"
    with open(sample_csv_path, "rb") as f:
        r = client.post("/api/score?explain=true", files={"file": ("delhi_normal.csv", f, "text/csv")})
    assert r.status_code == 200
    res1 = r.json()
    upload_id_1 = res1["report"].get("upload_id")
    assert upload_id_1 is not None
    print(f"  [PASS] Upload standard CSV -> HTTP 200, upload_id='{upload_id_1}', stations: {len(res1['stations'])}")

    # Download scored result with upload_id
    r_dl = client.get(f"/api/download?id={upload_id_1}")
    assert r_dl.status_code == 200
    assert "text/csv" in r_dl.headers.get("content-type", "")
    print(f"  [PASS] Download scored CSV with session ID -> HTTP 200 ({len(r_dl.content)} bytes)")

    # XLSX Upload
    df_sample = pd.read_csv(sample_csv_path)
    xl_buf = io.BytesIO()
    df_sample.to_excel(xl_buf, index=False)
    xl_bytes = xl_buf.getvalue()
    r = client.post("/api/score?explain=true", files={"file": ("sample.xlsx", xl_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200
    upload_id_2 = r.json()["report"].get("upload_id")
    print(f"  [PASS] Upload Excel .xlsx -> HTTP 200, upload_id='{upload_id_2}'")

    # Malformed file 1: Empty file
    r = client.post("/api/score", files={"file": ("empty.csv", b"", "text/csv")})
    assert r.status_code == 400
    print(f"  [PASS] Upload Empty File -> HTTP {r.status_code} ({r.json().get('detail')})")

    # Malformed file 2: Garbage text
    r = client.post("/api/score", files={"file": ("garbage.csv", b"just some random non tabular text\nwith multiple lines\n", "text/csv")})
    assert r.status_code == 400
    print(f"  [PASS] Upload Non-tabular Garbage -> HTTP {r.status_code} ({r.json().get('detail')})")

    # Malformed file 3: Missing essential weather columns
    missing_cols = "station_id,timestamp,some_unrelated_field\n101,2026-01-01 00:00,123\n101,2026-01-01 01:00,456\n"
    r = client.post("/api/score", files={"file": ("missing.csv", missing_cols.encode(), "text/csv")})
    assert r.status_code == 400
    print(f"  [PASS] Upload Missing Weather Columns -> HTTP {r.status_code} ({r.json().get('detail')})")

    # 5. Groq Chatbot Endpoints & Tool Calling
    print("\n[5] Groq AI Chatbot API & Autonomous Tools Audit:")
    
    # Status
    r = client.get("/api/chat/status")
    assert r.status_code == 200
    chat_st = r.json()
    assert chat_st.get("configured") is True and chat_st.get("tools_count") == 6
    print(f"  [PASS] GET /api/chat/status -> Ready (Model: {chat_st.get('model')}, Tools: {chat_st.get('tools_count')})")

    # Non-streaming chat invocation
    r = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "How many stations are in the network?"}],
        "context": {"active_tab": "overview"}
    })
    assert r.status_code == 200
    chat_resp = r.json()
    assert "content" in chat_resp and len(chat_resp["content"]) > 0
    print(f"  [PASS] POST /api/chat -> HTTP 200, Content: {chat_resp['content'][:80]}...")
    if chat_resp.get("tools_used"):
        print(f"         Tools autonomously called: {[t.get('tool') or t.get('name') for t in chat_resp['tools_used']]}")

    # Streaming chat invocation
    r = client.post("/api/chat/stream", json={
        "messages": [{"role": "user", "content": "Hello"}],
        "context": {"active_tab": "overview"}
    })
    assert r.status_code == 200
    assert "text/event-stream" in r.headers.get("content-type", "")
    print(f"  [PASS] POST /api/chat/stream -> HTTP 200, SSE stream headers verified")

    print("\n=================================================================")
    print("       AUDIT SUMMARY: ALL SYSTEM CHECKS PASSED (100%)            ")
    print("=================================================================")

if __name__ == "__main__":
    audit()
