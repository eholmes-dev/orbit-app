export interface Label {
  id: string;
  name: string;
  description: string | null;
  _count?: { people: number; events: number };
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  department: string | null;
  active: boolean;
  maxHoursPerWeek: number | null;
  preferredHours: number | null;
  outlookAccountId: string | null;
  labels: { id: string; name: string }[];
  _count?: { assignments: number; availability: number };
  createdAt: string;
  updatedAt: string;
}

export interface CreateLabelInput {
  name: string;
  description?: string | null;
}

export interface CreatePersonInput {
  name: string;
  email: string;
  department?: string | null;
  active?: boolean;
  maxHoursPerWeek?: number | null;
  preferredHours?: number | null;
  outlookAccountId?: string | null;
  labelIds?: string[];
}

export interface Event {
  id: string;
  title: string;
  startDateTime: string;
  endDateTime: string;
  priorityTier: number;
  requiredStaffCount: number;
  isHardRequirement: boolean;
  recurrenceRule: string | null;
  location: string | null;
  requiredLabels: { id: string; name: string }[];
  _count?: { assignments: number };
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventInput {
  title: string;
  startDateTime: string;
  endDateTime: string;
  priorityTier: number;
  requiredStaffCount?: number;
  isHardRequirement?: boolean;
  recurrenceRule?: string | null;
  location?: string | null;
  requiredLabelIds?: string[];
}

export type AvailabilityType =
  | "vacation"
  | "PTO"
  | "appointment"
  | "blocked"
  | "recurring";

export type AvailabilitySource = "manual" | "outlook_sync";

export interface Availability {
  id: string;
  personId: string;
  person?: { id: string; name: string };
  type: AvailabilityType;
  startDateTime: string;
  endDateTime: string;
  source: AvailabilitySource;
  externalEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAvailabilityInput {
  personId: string;
  type: AvailabilityType;
  startDateTime: string;
  endDateTime: string;
}

export type AssignmentStatus = "proposed" | "confirmed" | "conflict";

export interface ScheduleAssignment {
  id: string;
  eventId: string;
  personId: string;
  status: AssignmentStatus;
  syncedToOutlookAt: string | null;
  event: {
    id: string;
    title: string;
    startDateTime: string;
    endDateTime: string;
    priorityTier: number;
  };
  person: { id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
}

export type ConflictReason =
  | "no_qualified_staff"
  | "no_availability"
  | "capacity_exhausted"
  | "over_constrained";

export interface ScheduleConflict {
  event_id: string;
  reason: ConflictReason;
  short_by: number;
  message: string;
}

export interface ScheduleWarning {
  person_id: string;
  person_name: string;
  type: "excess_hours" | "uneven_workload";
  value: number;
  message: string;
}

export interface GenerateScheduleResult {
  status: "optimal" | "feasible" | "infeasible" | "unknown";
  solveTimeMs: number;
  counts: {
    events: number;
    people: number;
    assignments: number;
    conflicts: number;
    warnings: number;
  };
  assignments: ScheduleAssignment[];
  conflicts: ScheduleConflict[];
  warnings: ScheduleWarning[];
}
