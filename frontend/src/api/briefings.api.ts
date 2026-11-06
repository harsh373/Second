import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type BriefingKind = "morning" | "weekly" | "pre_meeting";
export type BriefingPage = "commitments" | "open-loops" | "people";

export interface BriefingItem {
  text: string;
  when: string | null;
  detail: string | null;
  group: string | null;
  url: string | null;
  page: BriefingPage | null;
}

export interface BriefingSection {
  key: string;
  title: string;
  status: "ok" | "unavailable";
  note: string | null;
  items: BriefingItem[];
}

export interface BriefingContent {
  version: 1;
  timezone: string;
  date: string;
  warnings: string[];
  sections: BriefingSection[];
}

export interface BriefingSummary {
  id: string;
  kind: string;
  title: string;
  generatedAt: string;
}

export interface Briefing extends BriefingSummary {
  content: BriefingContent;
}

export interface UpcomingEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export const briefingsQueryOptions = queryOptions({
  queryKey: ["briefings"],
  queryFn: () => apiFetch<{ briefings: BriefingSummary[] }>("/briefings"),
});

export const upcomingEventsQueryOptions = queryOptions({
  queryKey: ["briefing-events"],
  queryFn: () => apiFetch<{ events: UpcomingEvent[] }>("/briefings/upcoming-events"),
  retry: false,
});

export function briefingQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["briefing", id],
    queryFn: () => apiFetch<{ briefing: Briefing }>(`/briefings/${id}`),
  });
}

export function generateBriefing(input: { kind: "morning" | "weekly" } | { kind: "pre_meeting"; eventId: string }) {
  return apiFetch<{ briefing: Briefing }>("/briefings", { method: "POST", data: input, timeout: 60_000 });
}