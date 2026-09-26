FROM python:3.11-slim

# Install OpenMP runtime required by LightGBM
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first for optimal Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source, models, and demo data (frontend excluded via .dockerignore)
COPY . .

# Render defaults: port 10000, unbuffered logging for real-time dashboard output
ENV PORT=10000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    SKYGUARD_DEMO_MODE=true

EXPOSE 10000

# Bind to 0.0.0.0 and dynamically honor Render's assigned PORT
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]

