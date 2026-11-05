import { apiFetch } from "./client";

type Params = Record<string, string>;

export const debugEvents = (params: Params) => apiFetch<unknown>("/calendar/events", { params });
export const debugEvent = (eventId: string) =>
  apiFetch<unknown>(`/calendar/events/${encodeURIComponent(eventId)}`);
export const debugAvailability = (params: Params) => apiFetch<unknown>("/calendar/availability", { params });
export const debugConflicts = (params: Params) => apiFetch<unknown>("/calendar/conflicts", { params });