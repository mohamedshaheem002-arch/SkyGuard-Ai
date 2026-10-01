"""Verification script for Groq token limit, streaming, and tool execution."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import json
from app.main import app
from fastapi.testclient import TestClient

def main():
    client = TestClient(app)
    queries = [
        ("What is happening across the network?", {"active_tab": "overview"}),
        ("Why is station 42042 flagged?", {"active_tab": "stations", "selected_station_id": "42042"}),
        ("Explain station 42042's sensor health.", {"active_tab": "stations", "selected_station_id": "42042"}),
    ]

    print("===============================================================")
    print(" Verifying Rate Limit & Token Budget Fix on Live Groq API")
    print("===============================================================\n")

    for q, ctx in queries:
        print(f"--- Testing Query: '{q}' ---")
        
        # Test 1: Non-streaming /api/chat
        res_chat = client.post("/api/chat", json={"messages": [{"role": "user", "content": q}], "context": ctx})
        assert res_chat.status_code == 200, f"Chat status {res_chat.status_code}"
        chat_data = res_chat.json()
        content = chat_data.get("content", "")
        tools = chat_data.get("tools_used", [])
        
        assert "429" not in content and "rate_limit" not in content.lower(), f"Rate limit error found: {content}"
        assert "⚠️" not in content, f"Service error returned: {content}"
        
        clean_snippet = content[:140].replace('\n', ' ').encode('ascii', errors='replace').decode('ascii')
        print(f"  [OK] /api/chat -> 200 OK | Tools used: {[t.get('tool') for t in tools]}")
        print(f"       Response snippet: {clean_snippet}...")

        # Test 2: Streaming /api/chat/stream
        res_stream = client.post("/api/chat/stream", json={"messages": [{"role": "user", "content": q}], "context": ctx})
        assert res_stream.status_code == 200, f"Stream status {res_stream.status_code}"
        stream_text = res_stream.text
        assert "429" not in stream_text and "rate_limit" not in stream_text.lower(), f"Rate limit error in stream: {stream_text}"
        assert "⚠️" not in stream_text, f"Service error in stream: {stream_text}"
        print(f"  [OK] /api/chat/stream -> 200 OK | text/event-stream successfully streamed\n")

    print("===============================================================")
    print(" ALL 3 QUERIES COMPLETED WITH ZERO 429 ERRORS!")
    print("===============================================================")

if __name__ == "__main__":
    main()
