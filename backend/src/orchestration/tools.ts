import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { findConflicts, findFreeSlots, getEvent, listEvents, resolveWindow } from "../utility/calendar";
import { findUnansweredThreads, getThread, searchByPerson, searchThreads } from "../utility/gmail";

const MAX_OUTPUT_CHARS = 12_000;
const BODY_CHARS_PER_MESSAGE = 1_500;
const MAX_THREAD_MESSAGES = 6;

// The user id comes from the backend (set per request), never from the model's arguments.
function userIdOf(config?: RunnableConfig): string {
  const id = config?.configurable?.userId;
  if (typeof id !== "string" || id.length === 0) throw new Error("Missing user context for tool call.");
  return id;
}

// Always returns valid JSON text, cut down if too large.
function limit(value: unknown): string {
  const json = JSON.stringify(value);
  if (json.length <= MAX_OUTPUT_CHARS) return json;
  return JSON.stringify({
    truncated: true,
    note: "The output was too large and was cut. Use a narrower query or a shorter time range.",
    preview: json.slice(0, MAX_OUTPUT_CHARS),
  });
}

function clamp(n: number | undefined, fallback: number, max: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

const DATE_HELP =
  "YYYY-MM-DD in the user's timezone, or an ISO datetime WITH a UTC offset (for example 2026-11-06T09:00:00+05:30).";
const fromField = z.string().optional().describe(`Start of the range. ${DATE_HELP} Defaults to the start of today.`);
const toField = z
  .string()
  .optional()
  .describe(`End of the range. ${DATE_HELP} A plain date means the END of that day. Defaults to 7 days after the start.`);

async function eventsInWindow(
  userId: string,
  from: string | undefined,
  to: string | undefined,
  options: { calendarId?: string | undefined; maxResults?: number | undefined } = {},
) {
  const w = await resolveWindow(userId, from, to);
  const events = await listEvents(userId, {
    timeMin: new Date(w.timeMin),
    timeMax: new Date(w.timeMax),
    timezone: w.timezone,
    ...(options.calendarId ? { calendarId: options.calendarId } : {}),
    ...(options.maxResults ? { maxResults: options.maxResults } : {}),
  });
  return { window: w, events };
}

const searchThreadsTool = tool(
  async ({ query, maxResults }, config) => {
    const result = await searchThreads(userIdOf(config), {
      ...(query ? { query } : {}),
      maxResults: clamp(maxResults, 10, 20),
    });
    return limit(result);
  },
  {
    name: "search_threads",
    description:
      "Search the user's Gmail threads with Gmail search syntax (for example from:alice@example.com, newer_than:7d, is:unread, subject:invoice, has:attachment). Returns thread summaries only, not full bodies. Use get_thread to read one thread.",
    schema: z.object({
      query: z.string().optional().describe("Gmail search query. Leave out to list recent threads."),
      maxResults: z.number().optional().describe("How many threads to return. Default 10, maximum 20."),
    }),
  },
);

const getThreadTool = tool(
  async ({ threadId }, config) => {
    const thread = await getThread(userIdOf(config), threadId);
    return limit({
      ...thread,
      omittedEarlierMessages: Math.max(0, thread.messages.length - MAX_THREAD_MESSAGES),
      messages: thread.messages.slice(-MAX_THREAD_MESSAGES).map((m) => ({
        ...m,
        bodyText: typeof m.bodyText === "string" ? m.bodyText.slice(0, BODY_CHARS_PER_MESSAGE) : m.bodyText,
      })),
    });
  },
  {
    name: "get_thread",
    description:
      "Read one Gmail thread (the latest messages, with body text shortened). Use it only when a thread summary is not enough, because it is expensive. The threadId must come from another tool's result.",
    schema: z.object({ threadId: z.string().describe("The Gmail thread id from an earlier tool result.") }),
  },
);

const searchByPersonTool = tool(
  async ({ person, maxResults }, config) =>
    limit(await searchByPerson(userIdOf(config), person, clamp(maxResults, 10, 20))),
  {
    name: "search_by_person",
    description:
      "Find Gmail threads where a person is the sender, a recipient or in CC. Give an email address, or a name if no address is known.",
    schema: z.object({
      person: z.string().describe("Email address or name of the person."),
      maxResults: z.number().optional().describe("How many threads to return. Default 10, maximum 20."),
    }),
  },
);

const findUnansweredTool = tool(
  async ({ sinceDays, waitingDays }, config) =>
    limit(
      await findUnansweredThreads(userIdOf(config), {
        ...(sinceDays ? { sinceDays: clamp(sinceDays, 14, 60) } : {}),
        ...(waitingDays ? { waitingDays: clamp(waitingDays, 3, 30) } : {}),
      }),
    ),
  {
    name: "find_unanswered_threads",
    description:
      "Rule-based scan of recent Gmail. Returns needsReply (threads where someone wrote to the user last and the user has not answered) and waitingOn (threads where the user wrote last and got no answer). Use this for questions like 'what do I need to reply to' or 'what am I waiting on'. These lists are heuristics, not certainty.",
    schema: z.object({
      sinceDays: z.number().optional().describe("How many days back to scan. Default 14, maximum 60."),
      waitingDays: z
        .number()
        .optional()
        .describe("A thread counts as waiting on someone after this many days of silence. Default 3."),
    }),
  },
);

const listEventsTool = tool(
  async ({ from, to, calendarId, maxResults }, config) => {
    const { window, events } = await eventsInWindow(userIdOf(config), from, to, {
      calendarId,
      maxResults: clamp(maxResults, 25, 50),
    });
    return limit({
      timezone: window.timezone,
      from: new Date(window.timeMin).toISOString(),
      to: new Date(window.timeMax).toISOString(),
      count: events.length,
      events,
    });
  },
  {
    name: "list_events",
    description:
      "List the user's Google Calendar events in a date range, with times in the user's timezone. Defaults to today through the next 7 days. Maximum range is 62 days.",
    schema: z.object({
      from: fromField,
      to: toField,
      calendarId: z.string().optional().describe("Calendar id. Defaults to the primary calendar."),
      maxResults: z.number().optional().describe("Default 25, maximum 50."),
    }),
  },
);

const getEventTool = tool(
  async ({ eventId, calendarId }, config) => limit(await getEvent(userIdOf(config), eventId, calendarId ?? "primary")),
  {
    name: "get_event",
    description: "Get the full details of one calendar event. The eventId must come from an earlier tool result.",
    schema: z.object({
      eventId: z.string().describe("The event id from an earlier tool result."),
      calendarId: z.string().optional().describe("Calendar id. Defaults to the primary calendar."),
    }),
  },
);

const findFreeSlotsTool = tool(
  async ({ from, to, minMinutes, workStartHour, workEndHour }, config) => {
    const userId = userIdOf(config);
    const w = await resolveWindow(userId, from, to);
    const slots = await findFreeSlots(userId, {
      timeMin: new Date(w.timeMin),
      timeMax: new Date(w.timeMax),
      timezone: w.timezone,
      ...(minMinutes ? { minMinutes: Math.max(5, Math.trunc(minMinutes)) } : {}),
      ...(workStartHour !== undefined && workEndHour !== undefined
        ? { workingHours: { startHour: workStartHour, endHour: workEndHour } }
        : {}),
    });
    return limit({
      timezone: w.timezone,
      from: new Date(w.timeMin).toISOString(),
      to: new Date(w.timeMax).toISOString(),
      result: slots,
    });
  },
  {
    name: "find_free_slots",
    description:
      "Find free time on the user's calendar in a date range. Never returns slots in the past. Use it for questions like 'when am I free for an hour this week'.",
    schema: z.object({
      from: fromField,
      to: toField,
      minMinutes: z.number().optional().describe("Minimum length of a free slot in minutes. Default 30."),
      workStartHour: z.number().optional().describe("Only offer slots after this hour (0-23, user's timezone). Use together with workEndHour."),
      workEndHour: z.number().optional().describe("Only offer slots before this hour (0-23, user's timezone). Use together with workStartHour."),
    }),
  },
);

const findConflictsTool = tool(
  async ({ from, to }, config) => {
    const { events } = await eventsInWindow(userIdOf(config), from, to, { maxResults: 50 });
    const conflicts = findConflicts(events);
    return limit({ eventsChecked: events.length, count: conflicts.length, conflicts });
  },
  {
    name: "find_conflicts",
    description:
      "Find overlapping calendar events in a date range (ignores all-day, cancelled, free and declined events). Defaults to today through the next 7 days.",
    schema: z.object({ from: fromField, to: toField }),
  },
);

export const agentTools = [
  searchThreadsTool,
  getThreadTool,
  searchByPersonTool,
  findUnansweredTool,
  listEventsTool,
  getEventTool,
  findFreeSlotsTool,
  findConflictsTool,
];

// ---- Helpers the graph uses to describe calls and results to the user (not the model) ----

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "search_threads": {
      const q = str(args.query);
      return q ? `Searching your inbox for "${q}"` : "Looking at your recent inbox";
    }
    case "get_thread":
      return "Reading an email thread";
    case "search_by_person":
      return `Looking for emails with ${str(args.person) ?? "that person"}`;
    case "find_unanswered_threads":
      return "Checking which emails are waiting on a reply";
    case "list_events": {
      const from = str(args.from);
      const to = str(args.to);
      return from || to ? `Checking your calendar (${from ?? "today"} to ${to ?? "next 7 days"})` : "Checking your calendar";
    }
    case "get_event":
      return "Opening a calendar event";
    case "find_free_slots":
      return "Finding free time on your calendar";
    case "find_conflicts":
      return "Looking for calendar conflicts";
    default:
      return `Running ${name}`;
  }
}

export function describeToolResult(parsed: unknown): string {
  if (Array.isArray(parsed)) return `${parsed.length} result${parsed.length === 1 ? "" : "s"}`;
  if (parsed && typeof parsed === "object") {
    const parts = Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => `${(v as unknown[]).length} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`);
    if (parts.length > 0) return parts.join(", ");
  }
  return "Done";
}

// Finds every "sourceUrl" in a tool result (Gmail threads, calendar events).
export function collectSourceUrls(value: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 5 || found.length >= 8 || value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceUrls(item, found, depth + 1);
    return found;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "sourceUrl" && typeof v === "string" && v.startsWith("https://") && !found.includes(v)) {
      if (found.length < 8) found.push(v);
    } else {
      collectSourceUrls(v, found, depth + 1);
    }
  }
  return found;
}