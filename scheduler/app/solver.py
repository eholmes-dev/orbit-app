"""OR-Tools CP-SAT solver for the Orbit scheduling problem.

Each (event, person) pair is a boolean variable. Hard rules (labels, availability,
no-double-booking) are encoded as constraints. Required staffing is encoded as a
soft constraint with shortfall slack variables weighted by priority tier; this
keeps the model always feasible and surfaces over-constrained cases as conflicts.
"""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime

from ortools.sat.python import cp_model

from .models import (
    AssignmentResult,
    AvailabilityWindow,
    ConflictReason,
    ConflictResult,
    EventInput,
    PersonInput,
    SolveRequest,
    SolveResponse,
    WarningResult,
)


# Weight per tier-1 staffing shortfall. Tier N is divided by N — Tier 1 = 100k,
# Tier 5 = 20k. Hard requirements get a 10x bump so the solver fights hardest to
# cover them.
TIER_BASE_WEIGHT = 100_000
HARD_REQUIREMENT_MULTIPLIER = 10
EXCESS_HOUR_WEIGHT = 50
WORKLOAD_VARIANCE_WEIGHT = 10


def _events_overlap(a: EventInput, b: EventInput) -> bool:
    return a.start < b.end and b.start < a.end


def _availability_blocks_event(av: AvailabilityWindow, ev: EventInput) -> bool:
    return av.start < ev.end and ev.start < av.end


def _person_qualified(person: PersonInput, event: EventInput) -> bool:
    return set(event.required_label_ids).issubset(set(person.label_ids))


def _event_duration_minutes(ev: EventInput) -> int:
    return max(0, int((ev.end - ev.start).total_seconds() // 60))


def _categorize_conflict(
    event: EventInput,
    people: list[PersonInput],
    availability_by_person: dict[str, list[AvailabilityWindow]],
) -> ConflictReason:
    """Classify *why* an event ended up understaffed."""
    qualified = [p for p in people if _person_qualified(p, event)]
    # Zero qualified OR not enough qualified people for the staffing requirement.
    if len(qualified) < event.required_staff_count:
        return "no_qualified_staff"

    available_qualified = [
        p
        for p in qualified
        if not any(
            _availability_blocks_event(av, event)
            for av in availability_by_person.get(p.id, [])
        )
    ]
    if len(available_qualified) < event.required_staff_count:
        return "no_availability"

    # Qualified + available people exist in sufficient numbers, but the solver
    # still couldn't fill the slot — they're double-booked or hours-capped.
    return "capacity_exhausted"


def solve(request: SolveRequest) -> SolveResponse:
    started = time.monotonic()
    model = cp_model.CpModel()

    people = request.people
    events = request.events
    availability = request.availability

    # Index lookups.
    person_index = {p.id: i for i, p in enumerate(people)}
    event_index = {e.id: i for i, e in enumerate(events)}
    availability_by_person: dict[str, list[AvailabilityWindow]] = defaultdict(list)
    for av in availability:
        availability_by_person[av.person_id].append(av)

    # x[e, p] = 1 iff person p is assigned to event e. Only create the var if
    # the person is qualified AND not blocked — otherwise treat as fixed-zero.
    x: dict[tuple[int, int], cp_model.IntVar] = {}
    for ei, event in enumerate(events):
        for pi, person in enumerate(people):
            if not _person_qualified(person, event):
                continue
            if any(
                _availability_blocks_event(av, event)
                for av in availability_by_person.get(person.id, [])
            ):
                continue
            x[(ei, pi)] = model.NewBoolVar(f"x_e{ei}_p{pi}")

    # Hard constraint 1: never assign more than required_staff_count.
    for ei, event in enumerate(events):
        candidates = [x[(ei, pi)] for pi in range(len(people)) if (ei, pi) in x]
        if candidates:
            model.Add(sum(candidates) <= event.required_staff_count)

    # Hard constraint 2: no person double-booked on overlapping events.
    for e1 in range(len(events)):
        for e2 in range(e1 + 1, len(events)):
            if not _events_overlap(events[e1], events[e2]):
                continue
            for pi in range(len(people)):
                v1 = x.get((e1, pi))
                v2 = x.get((e2, pi))
                if v1 is not None and v2 is not None:
                    model.Add(v1 + v2 <= 1)

    # Soft: shortfall per event = required - assigned. Weighted by tier.
    shortfall_terms: list[cp_model.IntVar] = []
    shortfall_weights: list[int] = []
    shortfall_by_event: dict[int, cp_model.IntVar] = {}
    for ei, event in enumerate(events):
        candidates = [x[(ei, pi)] for pi in range(len(people)) if (ei, pi) in x]
        assigned_count = sum(candidates) if candidates else 0
        s = model.NewIntVar(0, event.required_staff_count, f"short_e{ei}")
        model.Add(s >= event.required_staff_count - assigned_count)
        shortfall_by_event[ei] = s
        weight = TIER_BASE_WEIGHT // event.priority_tier
        if event.is_hard_requirement:
            weight *= HARD_REQUIREMENT_MULTIPLIER
        shortfall_terms.append(s)
        shortfall_weights.append(weight)

    # Soft: excess hours per person. Penalize hours above max_hours_per_week
    # (interpreted as max hours over the solver window, not literally a week).
    excess_terms: list[cp_model.IntVar] = []
    excess_weights: list[int] = []
    hours_var_by_person: dict[int, cp_model.IntVar] = {}
    for pi, person in enumerate(people):
        # hours per person, in minutes for integer math
        person_minutes = []
        for ei, event in enumerate(events):
            if (ei, pi) in x:
                person_minutes.append(x[(ei, pi)] * _event_duration_minutes(event))
        if not person_minutes:
            continue
        total_minutes_upper = sum(_event_duration_minutes(e) for e in events) or 1
        total = model.NewIntVar(0, total_minutes_upper, f"hours_p{pi}")
        model.Add(total == sum(person_minutes))
        hours_var_by_person[pi] = total
        if person.max_hours_per_week is not None:
            cap_minutes = person.max_hours_per_week * 60
            excess = model.NewIntVar(0, total_minutes_upper, f"excess_p{pi}")
            model.Add(excess >= total - cap_minutes)
            excess_terms.append(excess)
            excess_weights.append(EXCESS_HOUR_WEIGHT)

    # Soft: workload variance — penalize spread = max(hours) - min(hours).
    spread_terms: list[cp_model.IntVar] = []
    spread_weights: list[int] = []
    if len(hours_var_by_person) >= 2:
        total_minutes_upper = sum(_event_duration_minutes(e) for e in events) or 1
        hmax = model.NewIntVar(0, total_minutes_upper, "hmax")
        hmin = model.NewIntVar(0, total_minutes_upper, "hmin")
        for v in hours_var_by_person.values():
            model.Add(hmax >= v)
            model.Add(hmin <= v)
        spread = model.NewIntVar(0, total_minutes_upper, "spread")
        model.Add(spread == hmax - hmin)
        spread_terms.append(spread)
        spread_weights.append(WORKLOAD_VARIANCE_WEIGHT)

    objective_terms = (
        [w * t for w, t in zip(shortfall_weights, shortfall_terms)]
        + [w * t for w, t in zip(excess_weights, excess_terms)]
        + [w * t for w, t in zip(spread_weights, spread_terms)]
    )
    if objective_terms:
        model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(request.time_limit_seconds)
    status = solver.Solve(model)

    status_map = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.UNKNOWN: "unknown",
        cp_model.MODEL_INVALID: "unknown",
    }
    status_str = status_map.get(status, "unknown")

    assignments: list[AssignmentResult] = []
    conflicts: list[ConflictResult] = []
    warnings: list[WarningResult] = []

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (ei, pi), var in x.items():
            if solver.Value(var) == 1:
                assignments.append(
                    AssignmentResult(
                        event_id=events[ei].id,
                        person_id=people[pi].id,
                    )
                )

        for ei, event in enumerate(events):
            short = solver.Value(shortfall_by_event[ei])
            if short > 0:
                reason = _categorize_conflict(event, people, availability_by_person)
                conflicts.append(
                    ConflictResult(
                        event_id=event.id,
                        reason=reason,
                        short_by=int(short),
                        message=_conflict_message(event, reason, int(short)),
                    )
                )

        for pi, person in enumerate(people):
            if pi not in hours_var_by_person:
                continue
            total_minutes = solver.Value(hours_var_by_person[pi])
            total_hours = total_minutes / 60.0
            if (
                person.max_hours_per_week is not None
                and total_hours > person.max_hours_per_week
            ):
                warnings.append(
                    WarningResult(
                        person_id=person.id,
                        type="excess_hours",
                        value=total_hours,
                        message=(
                            f"Assigned {total_hours:.1f}h exceeds max "
                            f"{person.max_hours_per_week}h."
                        ),
                    )
                )

    return SolveResponse(
        status=status_str,
        assignments=assignments,
        conflicts=conflicts,
        warnings=warnings,
        solve_time_ms=int((time.monotonic() - started) * 1000),
    )


def _conflict_message(event: EventInput, reason: ConflictReason, short_by: int) -> str:
    reason_human = {
        "no_qualified_staff": "no person has all required labels",
        "no_availability": "all qualified people are blocked or on PTO",
        "capacity_exhausted": "all qualified+available people are over capacity",
        "over_constrained": "no feasible assignment within constraints",
    }[reason]
    return f'"{event.id}" is short by {short_by} — {reason_human}.'
