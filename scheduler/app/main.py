from fastapi import FastAPI

from .models import SolveRequest, SolveResponse
from .solver import solve

app = FastAPI(title="Orbit Scheduler", version="0.2.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "scheduler"}


@app.post("/solve", response_model=SolveResponse)
def solve_endpoint(request: SolveRequest) -> SolveResponse:
    return solve(request)
