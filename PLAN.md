# SkyGuard AI: Production Architecture & Implementation Plan

## Executive Summary
SkyGuard AI is a physics-informed, spatially-aware anomaly detection system for Automated Weather Station (AWS) networks. It combines World Meteorological Organization (WMO) Tier-1 deterministic quality control, station-level climatological baselines, the Hubbard Spatial Regression Test (SRT), and LightGBM machine learning models to detect, classify, explain, and correct weather station anomalies.

This plan details the current state, existing capabilities, gaps for public production deployment, and the recommended roadmap to transform the localhost prototype into a scalable public web application.

---

## 1. What Already Works

### A. Data Ingestion & Schema Normalization (`skyguard/data.py`)
- **Tolerant Schema Normalizer (`normalise_schema`)**: Maps arbitrary column names to canonical fields (`ts`, `station_id`, `temp`, `pres`, `rh`, `lat`, `lon`, `elev`) using exact aliases, keyword substring matches, and content-based physical range inference.
- **Unit Normalization**: Automatically identifies and converts temperatures (Kelvin, Fahrenheit $\rightarrow$ °C), pressure (Pa, inHg, mmHg $\rightarrow$ hPa), and humidity (fraction $0.0-1.0 \rightarrow 0-100\%$).
- **Multi-Format Ingestion (`read_any_table`)**: Parses CSV, TSV, pipe-delimited, semicolon-delimited, UTF-8/UTF-16 with/without BOM, Latin-1, and Excel `.xlsx` files.
- **Cadence & Grid Regularization**: Automatically infers sampling cadence (1-minute to 24-hour) and snaps observations to a regular grid per station, exposing communication gaps as explicit `NaN` records.
- **Cold-Start Registration (`register_unseen`)**: Handles new/unseen stations at runtime by fitting an on-the-fly local climatology regularized by network-wide priors, and binds spatial regression neighbors if coordinates are provided.

### B. Multi-Tiered QC & Detection Engine (`skyguard/engine.py`)
- **Tier-1 Deterministic QC (`qc.py`)**: Runs pure WMO-TD-1236 rules without ML:
  - Physical limits (e.g., Temperature outside $-80^\circ\text{C}$ to $+60^\circ\text{C}$).
  - Logger fill values ($-999, 9999$, etc.) disambiguated from valid pressures (e.g., $999.9\text{ hPa}$).
  - Stale repeated telemetry packets.
  - Duplicate timestamps.
  - Internal physical consistency: Dew point exceeding air temperature ($T_d > T$).
- **Climatological Baseline Engine (`climatology.py`)**:
  - Station $\times$ month $\times$ hour robust median and Median Absolute Deviation (MAD).
  - Robust hourly step scale and 99th-percentile streak length for variability checks.
- **Spatial Regression Test & Witness Agreement (`spatial.py`)**:
  - Pairwise robust linear regression (Hubbard ACIS method) modeling elevation/coastal offsets between neighboring stations.
  - Spatial $z$-score calculation against neighbor ensemble.
  - **Witness Agreement**: Fraction of neighbors simultaneously exhibiting anomalous deviations in the same direction, preventing regional extreme weather events from being misclassified as sensor faults.
- **Feature Extraction Pipeline (`features.py`)**: Computes ~104 features:
  - Diurnal/seasonal harmonics, climatological $z$-scores, hourly acceleration.
  - 6h/24h/72h rolling statistics, EWMA trends, and CUSUM (Page 1954) control charts for progressive drift and step bias.
  - Physical cross-correlation (e.g., 12-hour Temperature vs. Relative Humidity correlation).
- **Machine Learning Inference (`models/skyguard_models.joblib`)**:
  - Binary LightGBM detector predicting fault probability $p_{\text{fault}}$ against calibrated decision threshold $\theta \approx 0.85$.
  - Multiclass LightGBM classifier identifying root cause (`spike`, `noise`, `frozen`, `drift`, `bias`, `inconsistency`).
  - TreeExplainer SHAP integration providing top feature attributions for active alerts.
- **Arbitration & Decision Layer (`decision.py`)**:
  - Deterministic Gross-Step Spike Guard ($|step\_z| \ge 10, |cz| \ge 6, \text{witness} < 0.5$).
  - Integer Resolution Guard (`integer_resolution`): Prevents false frozen alerts on loggers recording in whole numbers.
  - Generates 5 discrete verdicts: `NORMAL`, `SENSOR_FAULT`, `GENUINE_WEATHER_EVENT`, `DATA_COMM_ISSUE`, `UNCERTAIN`.
  - Severity scoring (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
  - Blended corrected value calculation (inverse-variance neighbor estimate + climatology fallback).
  - 7-day station and sensor health index ($0-100$) with estimated days to tolerance breach.

### C. Pre-Computed Network & Benchmark Baseline
- Pre-scored 43 Indian WMO stations across diverse climates (March–June 2025 held-out test window) with ground-truth injected faults in `data/demo_scored.parquet` and `data/demo_report.json`.
- Validated performance metrics (`models/metrics.json`): Point precision $\approx 95.3\%$, overall event detection rate $\approx 86.1\%$, false alarms on normal hours $\approx 0.5\%$, and false alarms on genuine extreme weather $\approx 0.8\%$.

---

## 2. Existing API Endpoints (`app/main.py`)

| Method | Endpoint | Description | Query / Body Parameters | Response Format |
|---|---|---|---|---|
| `GET` | `/` | Serves main UI | None | `text/html` (`index.html`) |
| `GET` | `/api/meta` | Station metadata, model threshold, neighbors list, benchmark metrics | None | JSON (`stations`, `theta`, `metrics`, `neighbours`, etc.) |
| `GET` | `/api/overview` | Network-wide summary, health, recent alert episodes, and latest observations | None | JSON (`report`, `stations`, `recent_alerts`, `latest`) |
| `GET` | `/api/station/{sid}` | Historical time-series, alerts, confusion matrix, and health for a station | `days` (query int, 1–120, default 14) | JSON (`station_id`, `series`, `alerts`, `health`, `confusion`) |
| `POST` | `/api/score` | File upload ingestion & scoring (CSV/TSV/XLSX up to 400k rows) | `file` (Multipart UploadFile), `explain` (bool) | JSON (`report`, `alerts`, `stations`, `series`) |
| `GET` | `/api/download` | Exports the last uploaded & scored file as CSV | None | `text/csv` (`skyguard_scored.csv`) |
| `GET` | `/api/sample_csv` | Generates a sample messy CSV with unusual headers, Kelvin, Pa, etc. | None | `text/csv` (`sample_judge.csv`) |
| `GET` | `/static/*` | Static assets | None | Static vendor assets (`chart.umd.min.js`, etc.) |

---

## 3. Existing Model / Inference Flow

```
User Input (CSV / TSV / XLSX / Network Archive)
   │
   ▼
[read_any_table] ──► Auto-detect encoding, BOM, delimiter, Excel format
   │
   ▼
[normalise_schema] ──► Aliases & value heuristics ──► [station_id, ts, temp, pres, rh]
   │                   Unit conversions (K/°F ─► °C, Pa/inHg ─► hPa, RH ratio ─► %)
   ▼
[regularise] ──► Regular time-grid alignment, gap exposure, duplicate detection
   │
   ▼
[register_unseen] ──► Runtime cold-start climatology fitting + spatial neighbors
   │
   ▼
[tier1] ──► Deterministic Hard QC (Range, Fill, Stale, Duplicate, Td > T)
   │
   ▼
[clean_for_features] ──► Replace hard invalid values with NaN (prevent rolling distortion)
   │
   ▼
[compute_features] ──► ~104 features: Climatology z-score, Step z-score, CUSUM,
   │                   Rolling Slope, Physics (T/RH corr, dew point), Spatial Regression (SRT)
   ▼
[ML Inference]
   ├── LightGBM Detector ──► p_fault
   ├── LightGBM Root Cause Classifier ──► Fault class probabilities
   └── TreeExplainer (SHAP) ──► Top 5 positive drivers (for active alerts)
   │
   ▼
[verdict] (Arbitration Layer)
   ├── Tier-1 Hard Failure? ──► SENSOR_FAULT / DATA_COMM_ISSUE
   ├── Gross-step Spike Rule? ──► SENSOR_FAULT (spike)
   ├── Low Fault Probability (p < θ)?
   │     ├── Witness Agreement >= 60% & |cz| > 4 ──► GENUINE_WEATHER_EVENT
   │     └── p >= 0.6θ ──► UNCERTAIN
   ├── High Fault Probability (p >= θ)?
   │     ├── Whole-number Logger Persistence Guard (< 12h run) ──► UNCERTAIN
   │     ├── Spatial Witness Agreement >= 75% ──► GENUINE_WEATHER_EVENT (regional override)
   │     └── Confirmed Fault ──► SENSOR_FAULT (spike/frozen/drift/bias/noise/inconsistency)
   └── Compute Corrected Value, Bias Estimate, Plain-English Explanation, Maintenance Action
   │
   ▼
[station_health] ──► 7-day health score (0-100), status (HEALTHY/WATCH/MAINTENANCE/CRITICAL),
                     and projected days to tolerance breach
```

---

## 4. What Can Be Reused Directly

1. **Complete ML Core Package (`skyguard/skyguard/`)**:
   - `engine.py`: Scorer engine entrypoint and orchestration.
   - `qc.py`: Deterministic WMO Tier-1 logic and logger resolution detection.
   - `climatology.py`: Robust multidimensional climatology tables and lookup logic.
   - `spatial.py`: Spatial regression modeling and witness agreement formulas.
   - `features.py`: Complete 104-feature engineering pipeline.
   - `decision.py`: Verdict arbitration, plain-English synthesis, blended correction, and health scoring.
   - `data.py`: Schema mapping, unit inference, and flexible file reader.
   - `physics.py` & `config.py`: Dew point formulas, physical constants, and WMO threshold tables.
2. **Trained Models & Context Weights (`models/`)**:
   - `skyguard_models.joblib`: Pretrained LightGBM detector and classifier.
   - `context.joblib`: Spatial models and climatological tables for the Indian network.
   - `metrics.json`: Empirical benchmark evaluation data.
3. **Demo Data Cache (`data/`)**:
   - `demo_scored.parquet` and `demo_report.json` for rapid initial cold-start page rendering without running heavy re-evaluations.

---

## 5. What Must Change for a Public Website

### A. State Management & Concurrency
- **Problem**: `app/main.py` uses global module-level dictionary `_CACHE["upload"]`. Multiple concurrent users uploading files will overwrite each other's data, causing race conditions in scoring and file downloads (`/api/download`).
- **Fix**: Decouple state per user/session using job UUIDs stored in Redis or temporary storage with time-to-live (TTL) expiration.

### B. Asynchronous Job Processing & Timeouts
- **Problem**: `/api/score` executes heavy feature extraction and SHAP values synchronously in the HTTP request thread. Files with hundreds of thousands of rows will cause reverse proxies (e.g. Cloudflare, AWS ALB) to encounter 504 Gateway Timeouts.
- **Fix**: Implement an asynchronous task queue (FastAPI `BackgroundTasks`, Celery, or RQ) with an endpoint for polling job progress (`/api/jobs/{id}`) or a WebSocket connection for real-time progress updates.

### C. Security, Rate Limiting & Resource Protection
- **Problem**: Publicly exposing file uploads without authentication or rate limits opens the server to Denial of Service (DoS) attacks via memory exhaustion or heavy SHAP calculations.
- **Fix**:
  - Add rate limiting (e.g., `slowapi` or Redis token bucket).
  - Enforce strict upload file size caps (e.g., 25MB max) and row count limits before processing.
  - Implement CORS middleware, security headers (CSP, HSTS, X-Content-Type-Options), and input sanitation.

### D. Streaming Ingestion / Real-time API
- **Problem**: Currently, inference operates primarily in batch mode over CSV/Parquet uploads.
- **Fix**: Expose a single-point/batch streaming JSON endpoint (`POST /api/v1/stream/reading`) using the existing `SpatialModel.estimate_point()` streaming methods for live AWS IoT telemetry feeds.

### E. Frontend & User Experience Modernization
- **Problem**: The existing frontend is a monolithic 50KB single-file HTML with basic inline SVG map projection of India.
- **Fix**:
  - Upgrade to an interactive GIS map (Leaflet / MapLibre GL) supporting zoom, pan, tile layers, and clustering.
  - Provide a responsive layout, loading states, file upload progress bars, and pagination for large tables.
  - Decouple frontend from backend for independent CDN hosting and deployment.

---

## 6. Recommended Architecture

```
                    ┌───────────────────────────┐
                    │    Cloudflare CDN / DNS   │
                    │   (DDoS, SSL, Edge Cache) │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │    Nginx / Caddy Proxy    │
                    │  (Reverse Proxy, Gzip)    │
                    └──────┬─────────────┬──────┘
                           │             │
              Static Assets│             │API Requests
                           ▼             ▼
       ┌────────────────────────┐   ┌────────────────────────────────┐
       │   Frontend SPA         │   │   FastAPI Application Cluster  │
       │   (React / Vite)       │   │   (Uvicorn + Gunicorn Workers) │
       │   • Leaflet / MapLibre │   │   • Pydantic v2 validation     │
       │   • Chart.js / ECharts │   │   • Auth & Rate Limiting       │
       │   • Modern Design Sys  │   │   • Session / Job Manager      │
       └────────────────────────┘   └───────────────┬────────────────┘
                                                    │
                                  ┌─────────────────┴────────────────┐
                                  │                                  │
                                  ▼                                  ▼
                   ┌────────────────────────┐      ┌──────────────────────────────┐
                   │    Redis Task Broker   │      │    SkyGuard Engine Workers   │
                   │    & Cache Store       │◄────►│    (Celery / BackgroundPool) │
                   │    • Job status & TTL  │      │    • Schema normalizer       │
                   │    • Session storage   │      │    • Feature extraction      │
                   │    • Rate limit state  │      │    • LightGBM inference      │
                   └────────────────────────┘      │    • SHAP explanations       │
                                                   └──────────────┬───────────────┘
                                                                  │
                                                                  ▼
                                                   ┌──────────────────────────────┐
                                                   │    Model & Data Artifacts    │
                                                   │    • models/*.joblib         │
                                                   │    • demo_scored.parquet     │
                                                   │    • metrics.json            │
                                                   └──────────────────────────────┘
```

### Proposed Technology Stack:
1. **Backend**:
   - **Framework**: FastAPI (Python 3.11+).
   - **Engine**: Existing `skyguard` package (reused directly).
   - **Async Queue**: Celery / Redis or FastAPI BackgroundWorkers with file-backed session caching.
   - **Validation**: Pydantic v2 for all request/response models.
2. **Frontend**:
   - **Framework**: Vanilla JS/CSS (enhanced) or React/Vite SPA.
   - **Mapping**: Leaflet.js / MapLibre with OpenStreetMap tiles.
   - **Charts**: Chart.js with date-fns adapter (retaining the exact interactive timeline aesthetics).
   - **Styling**: Modern dark mode with HSL tokens, glassmorphism, responsive grid layouts.
3. **Deployment**:
   - **Containerization**: Multi-stage Dockerfile based on `python:3.11-slim` with `libgomp1`.
   - **Hosting Platforms**:
     - Fast Demo / Showcase: Hugging Face Spaces (Docker), Render, or Railway.
     - Production AWS / Cloud: AWS ECS / Fargate or GCP Cloud Run behind Cloudflare.

---

## 7. Next Steps & Implementation Milestones

- [ ] **Phase 1: Backend Hardening**
  - Refactor `app/main.py` to eliminate mutable global cache collision.
  - Implement task-based background scoring with job IDs (`/api/score/jobs/{job_id}`).
  - Add request rate-limiting and payload validation.
- [ ] **Phase 2: Public UI Polish**
  - Replace static SVG map with an interactive tile map (Leaflet).
  - Add file upload progress bar and drag-and-drop feedback.
  - Ensure full responsiveness on desktop, tablet, and mobile screens.
- [ ] **Phase 3: Production Deployment**
  - Optimize Docker build with caching and non-root user execution.
  - Configure production web server (Gunicorn with Uvicorn workers).
  - Set up CI/CD pipeline and automated health check endpoint (`/healthz`).
