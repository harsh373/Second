// Pure rules: no database, no AI. The same inputs always give the same score,
// and every point comes with a plain-language reason.

export type CommitmentStatus = "open" | "waiting" | "done";
export type Impact = "low" | "normal" | "high";

export interface PriorityInput {
  status: CommitmentStatus;
  dueDate: string | null; // YYYY-MM-DD
  impact: Impact;
  openDependents: number; // unfinished commitments that depend on this one
  openBlockers: number; // unfinished commitments this one depends on
  today: string; // YYYY-MM-DD in the user's timezone
}

export interface PriorityFactor {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface Priority {
  score: number;
  band: "high" | "medium" | "low";
  factors: PriorityFactor[];
}

// ---- Date helpers ----

// Today's date (YYYY-MM-DD) in the given IANA timezone.
export function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Whole days from one YYYY-MM-DD date to another (negative if "to" is earlier).
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

// ---- Scoring ----

const IMPACT_POINTS: Record<Impact, number> = { low: 0, normal: 8, high: 20 };
const IMPACT_DETAIL: Record<Impact, string> = {
  low: "Low impact",
  normal: "Normal impact",
  high: "High impact",
};
const DEPENDENT_POINTS = 7;
const DEPENDENT_CAP = 20;
const BLOCKED_PENALTY = -25;

function urgencyOf(dueDate: string | null, today: string): { points: number; detail: string } {
  if (!dueDate) return { points: 0, detail: "No due date" };
  const d = daysBetween(today, dueDate);
  if (d < 0) return { points: 40, detail: d === -1 ? "Overdue by 1 day" : `Overdue by ${-d} days` };
  if (d === 0) return { points: 36, detail: "Due today" };
  if (d === 1) return { points: 30, detail: "Due tomorrow" };
  if (d <= 3) return { points: 24, detail: `Due in ${d} days` };
  if (d <= 7) return { points: 16, detail: `Due in ${d} days` };
  if (d <= 14) return { points: 8, detail: `Due in ${d} days` };
  return { points: 3, detail: `Due in ${d} days` };
}

export function computePriority(input: PriorityInput): Priority {
  const urgency = urgencyOf(input.dueDate, input.today);
  const dependentPoints = Math.min(DEPENDENT_CAP, input.openDependents * DEPENDENT_POINTS);

  let blockedPoints = 0;
  let blockedDetail = "Not blocked";
  if (input.status === "waiting") {
    blockedPoints = BLOCKED_PENALTY;
    blockedDetail = "Waiting on someone else, so there is nothing for you to do yet";
  } else if (input.openBlockers > 0) {
    blockedPoints = BLOCKED_PENALTY;
    blockedDetail =
      input.openBlockers === 1
        ? "Blocked by 1 unfinished prerequisite"
        : `Blocked by ${input.openBlockers} unfinished prerequisites`;
  }

  const factors: PriorityFactor[] = [
    { key: "urgency", label: "Urgency", points: urgency.points, detail: urgency.detail },
    { key: "impact", label: "Impact", points: IMPACT_POINTS[input.impact], detail: IMPACT_DETAIL[input.impact] },
    {
      key: "dependents",
      label: "Unblocks others",
      points: dependentPoints,
      detail:
        input.openDependents === 0
          ? "Nothing else is waiting on this"
          : input.openDependents === 1
            ? "1 open commitment depends on this"
            : `${input.openDependents} open commitments depend on this`,
    },
    { key: "blocked", label: "Can you act on it?", points: blockedPoints, detail: blockedDetail },
  ];

  const score = Math.max(0, factors.reduce((sum, f) => sum + f.points, 0));
  const band = score >= 40 ? "high" : score >= 20 ? "medium" : "low";
  return { score, band, factors };
}