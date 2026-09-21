"""Convenience launcher:  python run.py  ->  http://localhost:8000   (or  python run.py 8080  /  PORT=8080 python run.py)"""
import os, sys, warnings
warnings.filterwarnings("ignore")
import uvicorn

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8000))
    print(f"SkyGuard AI starting -> open http://localhost:{port}  (Ctrl+C to stop)")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port)
