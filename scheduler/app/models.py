from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AvailabilityType = Literal["vacation", "PTO", "appointment", "blocked", "recurring"]
ConflictReason = Literal[
    "no_qualified_staff",
    "no_availability",
    "capacity_exhausted",
    "over_constrained",
]
WarningType = Literal["excess_hours", "uneven_workload"]
SolveStatus = Literal["optimal", "feasible", "infeasible", "unknown"]


class PersonInput(BaseModel):
    id: str
    label_ids: list[str] = Field(default_factory=list)
    max_hours_per_week: int | None = None
    preferred_hours: int | None = None


class EventInput(BaseModel):
    id: str
    start: datetime
    end: datetime
    priority_tier: int = Field(ge=1, le=5)
    required_staff_count: int = Field(ge=1)
    is_hard_requirement: bool = False
    required_label_ids: list[str] = Field(default_factory=list)


class AvailabilityWindow(BaseModel):
    person_id: str
    start: datetime
    end: datetime
    type: AvailabilityType


class SolveRequest(BaseModel):
    people: list[PersonInput]
    events: list[EventInput]
    availability: list[AvailabilityWindow] = Field(default_factory=list)
    time_limit_seconds: int = Field(default=10, ge=1, le=120)


class AssignmentResult(BaseModel):
    event_id: str
    person_id: str


class ConflictResult(BaseModel):
    event_id: str
    reason: ConflictReason
    short_by: int
    message: str


class WarningResult(BaseModel):
    person_id: str
    type: WarningType
    value: float
    message: str


class SolveResponse(BaseModel):
    status: SolveStatus
    assignments: list[AssignmentResult]
    conflicts: list[ConflictResult]
    warnings: list[WarningResult]
    solve_time_ms: int
