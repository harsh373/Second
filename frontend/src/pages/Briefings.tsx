import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  briefingQueryOptions,
  briefingsQueryOptions,
  generateBriefing,
  upcomingEventsQueryOptions,
  type Briefing,
  type BriefingPage,
  type BriefingSection,
} from "../api/briefings.api";
import { ApiError } from "../api/client";
import { toast } from "../components/ui/Toast";

const PAGE_LINK: Record<BriefingPage, { to: string; label: string }> = {
  commitments: { to: "/app/commitments", label: "Commitments" },
  "open-loops": { to: "/app/open-loops", label: "Open loops" },
  people: { to: "/app/people", label: "People" },
};

const KIND_LABEL: Record<string, string> = {
  morning: "Morning",
  weekly: "Weekly",
  pre_meeting: "Pre-meeting",
};

const buttonClass =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function eventLabel(e: { title: string; start: string; allDay: boolean }): string {
  const day = e.start.slice(5, 10).split("-").reverse().join("/"); // DD/MM
  return `${day} ${e.allDay ? "all day" : e.start.slice(11, 16)} · ${e.title}`;
}

function SectionView({ section }: { section: BriefingSection }) {
  let lastGroup: string | null = null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium tracking-wide text-ink-muted uppercase">{section.title}</h3>
      {section.status === "unavailable" && (
        <p className="rounded-xl border border-line bg-paper-dark px-4 py-3 text-sm text-ink">
          Could not build this section. {section.note}
        </p>
      )}
      {section.status === "ok" && section.note && <p className="text-sm text-ink-muted">{section.note}</p>}
      {section.items.length > 0 && (
        <ul className="space-y-2">
          {section.items.map((item, index) => {
            const showGroup = item.group !== null && item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <li key={index} className="space-y-2">
                {showGroup && <p className="pt-2 text-sm font-medium text-ink">{item.group}</p>}
                <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {item.when && <span className="mr-2 text-ink-muted">{item.when}</span>}
                      {item.text}
                    </p>
                    {item.detail && <p className="mt-0.5 text-xs text-ink-muted">{item.detail}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        Open <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                    {item.page && (
                      <Link to={PAGE_LINK[item.page].to} className="text-accent hover:underline">
                        {PAGE_LINK[item.page].label}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BriefingView({ briefing }: { briefing: Briefing }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl">{briefing.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Generated {formatTime(briefing.generatedAt)}. A snapshot built by fixed rules, not live.
        </p>
      </div>
      {briefing.content.warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-line bg-paper-dark px-4 py-3 text-sm text-ink">
          {briefing.content.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {briefing.content.sections.map((s) => (
        <SectionView key={s.key} section={s} />
      ))}
    </div>
  );
}

export default function Briefings() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eventId, setEventId] = useState("");

  const history = useQuery(briefingsQueryOptions);
  const events = useQuery(upcomingEventsQueryOptions);
  const selected = useQuery({ ...briefingQueryOptions(selectedId ?? ""), enabled: selectedId !== null });

  const generate = useMutation({
    mutationFn: generateBriefing,
    onSuccess: ({ briefing }) => {
      queryClient.setQueryData(["briefing", briefing.id], { briefing });
      setSelectedId(briefing.id);
      void queryClient.invalidateQueries({ queryKey: ["briefings"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not generate the briefing."),
  });

  const busyKind = generate.isPending ? generate.variables?.kind : null;
  const eventList = events.data?.events ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-4xl">Briefings</h1>
        <p className="mt-2 text-ink-muted">
          A briefing is a snapshot of your calendar, commitments and open loops, built by fixed rules, not written by AI.
          You generate it by pressing a button. Nothing runs automatically yet. The calendar is read live; open loops
          and people come from your last scan and refresh.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-3">
          <button type="button" className={buttonClass} disabled={generate.isPending} onClick={() => generate.mutate({ kind: "morning" })}>
            {busyKind === "morning" && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Morning briefing
          </button>
          <button type="button" className={buttonClass} disabled={generate.isPending} onClick={() => generate.mutate({ kind: "weekly" })}>
            {busyKind === "weekly" && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Weekly briefing
          </button>
        </div>

        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-sm font-medium text-ink">Before a meeting</p>
          {events.isLoading && <p className="text-sm text-ink-muted">Loading your upcoming events...</p>}
          {events.isError && (
            <p className="text-sm text-ink-muted">
              Could not read your calendar: {events.error instanceof ApiError ? events.error.message : "unknown error"}
            </p>
          )}
          {events.isSuccess && eventList.length === 0 && (
            <p className="text-sm text-ink-muted">No upcoming events in the next 7 days.</p>
          )}
          {eventList.length > 0 && (
            <div className="flex flex-wrap gap-3">
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              >
                <option value="">Choose an upcoming event</option>
                {eventList.map((e) => (
                  <option key={e.id} value={e.id}>
                    {eventLabel(e)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={buttonClass}
                disabled={generate.isPending || eventId === ""}
                onClick={() => generate.mutate({ kind: "pre_meeting", eventId })}
              >
                {busyKind === "pre_meeting" && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Brief me on this
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedId !== null && selected.isLoading && <p className="text-sm text-ink-muted">Opening briefing...</p>}
      {selectedId !== null && selected.isError && <p className="text-sm text-ink-muted">Could not open that briefing.</p>}
      {selected.data && <BriefingView briefing={selected.data.briefing} />}

      <section className="space-y-2">
        <h2 className="text-sm font-medium tracking-wide text-ink-muted uppercase">Saved briefings</h2>
        {history.isSuccess && history.data.briefings.length === 0 && (
          <p className="text-sm text-ink-muted">Nothing generated yet. The latest 30 are kept.</p>
        )}
        <ul className="space-y-2">
          {history.data?.briefings.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => setSelectedId(b.id)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-paper-dark"
              >
                <span className="min-w-0 truncate text-sm text-ink">{b.title}</span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {KIND_LABEL[b.kind] ?? b.kind} · {formatTime(b.generatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}