# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Orbit Python scheduler — FastAPI wrapping OR-Tools CP-SAT.
# uv-managed venv keeps the image small and reproducible.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime
WORKDIR /app

# `curl` for the HEALTHCHECK below; `uv` for the deterministic install.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.5.4

# Lockfile + manifest first so dependency layer is cached when only app
# source changes.
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --frozen 2>/dev/null || uv sync --no-dev

COPY app/ ./app/

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# `--host 0.0.0.0` so the container is reachable from other compose services
# (the backend container talks to `http://scheduler:8000` via the internal
# network).
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
