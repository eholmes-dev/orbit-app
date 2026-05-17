# Orbit Scheduler

Python microservice that wraps Google OR-Tools to solve healthcare scheduling as a constraint satisfaction problem.

## Setup

```powershell
uv sync
```

This creates `.venv/` and installs FastAPI, uvicorn, pydantic, and ortools.

## Run

```powershell
uv run uvicorn app.main:app --reload --port 8000
```

## Endpoints

- `GET /health` — service health check
- `POST /solve` — accepts scheduling problem, returns assignments + conflicts (Phase 2)
