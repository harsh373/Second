import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { formatDue } from "../api/commitments.api";
import {
  openLoopsQueryOptions,
  scanOpenLoops,
  updateOpenLoop,
  type LoopAction,
  type OpenLoopItem,
  type ScanSummary,
} from "../api/openLoops.api";
import { toast } from "../components/ui/Toast";

const buttonClass =
  "cursor-pointer rounded-md border border-line px-2 py-1 text-xs text-ink transition-colors hover:bg-paper-dark disabled:cursor-not-allowed disabled:opacity-50";

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Row({
  loop,
  today,
  busy,
  onAction,
}: {
  loop: OpenLoopItem;
  today: string;
  busy: boolean;
  onAction: (change: LoopAction) => void;
}) {
  const closed = loop.state === "resolved" || loop.state === "dismissed";
  const canOpen = loop.sourceUrl.startsWith("https://mail.google.com/");
  const who = loop.counterpart ? `${loop.kind === "needs_reply" ? "From" : "To"} ${loop.counterpart}` : null;

  let detail: string;
  if (loop.state === "snoozed" && loop.snoozedUntil) {
    detail = `Snoozed until ${formatDue(loop.snoozedUntil)} · ${plural(loop.daysSince, "day")} since the last message`;
  } else if (loop.state === "dismissed") {
    detail = `Dismissed${loop.resolvedAt ? ` · ${formatDay(loop.resolvedAt)}` : ""}`;
  } else if (loop.state === "resolved") {
    detail = `${loop.resolvedReason ?? "Resolved."}${loop.resolvedAt ? ` · ${formatDay(loop.resolvedAt)}` : ""}`;
  } else {
    detail = `${plural(loop.daysSince, "day")} since the last message`;
  }

  const canReopen = loop.state === "snoozed" || loop.state === "dismissed" || loop.resolvedBy === "user";

  return (
    <li className="space-y-2 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium break-words text-ink">{loop.subject}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted">
            {who && <span className="break-words">{who}</span>}
            <span>{detail}</span>
          </p>
        </div>
        {canOpen && (
          <a
            href={loop.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            Open in Gmail
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!closed && (
          <>
            <button type="button" disabled={busy} onClick={() => onAction({ action: "resolve" })} className={buttonClass}>
              Mark resolved
            </button>
            <select
              value=""
              disabled={busy}
              aria-label="Snooze"
              onChange={(e) => {
                const days = Number(e.target.value);
                if (days > 0) onAction({ action: "snooze", until: addDays(today, days) });
              }}
              className={buttonClass}
            >
              <option value="">Snooze…</option>
              <option value="1">Until tomorrow</option>
              <option value="3">For 3 days</option>
              <option value="7">For a week</option>
            </select>
            <button type="button" disabled={busy} onClick={() => onAction({ action: "dismiss" })} className={buttonClass}>
              Dismiss
            </button>
          </>
        )}
        {canReopen && (
          <button type="button" disabled={busy} onClick={() => onAction({ action: "reopen" })} className={buttonClass}>
            {loop.state === "snoozed" ? "Unsnooze" : "Reopen"}
          </button>
        )}
      </div>
    </li>
  );
}

function Section({
  title,
  hint,
  loops,
  today,
  busy,
  onAction,
}: {
  title: string;
  hint?: string;
  loops: OpenLoopItem[];
  today: string;
  busy: boolean;
  onAction: (id: string, change: LoopAction) => void;
}) {
  if (loops.length === 0) return null;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          {title} ({loops.length})
        </h2>
        {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      </div>
      <ul className="space-y-2">
        {loops.map((l) => (
          <Row key={l.id} loop={l} today={today} busy={busy} onAction={(change) => onAction(l.id, change)} />
        ))}
      </ul>
    </section>
  );
}

export default function OpenLoops() {
  const qc = useQueryClient();
  const query = useQuery(openLoopsQueryOptions);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [scanError, setScanError] = useState<{ message: string; google: boolean } | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["open-loops"] });

  const scan = useMutation({
    mutationFn: scanOpenLoops,
    onMutate: () => setScanError(null),
    onSuccess: (s) => {
      setSummary(s);
      refresh();
    },
    onError: (err) => {
      setSummary(null);
      const message = err instanceof Error ? err.message : "The scan failed.";
      const google = err instanceof ApiError && Boolean(err.code?.startsWith("GOOGLE_"));
      setScanError({ message, google });
      toast.error(message);
    },
  });

  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: LoopAction }) => updateOpenLoop(id, action),
    onSuccess: refresh,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update that loop."),
  });

  const data = query.data;
  const today = data?.today ?? "";
  const loops = data?.loops ?? [];
  const needsReply = loops.filter((l) => l.state === "active" && l.kind === "needs_reply");
  const waitingOn = loops.filter((l) => l.state === "active" && l.kind === "waiting_on");
  const snoozed = loops.filter((l) => l.state === "snoozed");
  const closed = loops.filter((l) => l.state === "resolved" || l.state === "dismissed");
  const open = needsReply.length + waitingOn.length + snoozed.length;
  const onAction = (id: string, action: LoopAction) => change.mutate({ id, action });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-4xl">Open loops</h1>
        <p className="text-sm text-ink-muted">
          Email threads that look unfinished: someone is waiting for your reply, or you are waiting for theirs. Press
          Scan inbox to refresh the list. Second does not watch your inbox in the background, and it stores only the
          subject, sender and a link, never the email text.
        </p>
      </header>

      <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={scan.isPending ? "size-4 animate-spin" : "size-4"} aria-hidden />
            {scan.isPending ? "Scanning…" : "Scan inbox"}
          </button>
          <span className="text-xs text-ink-muted">
            {data
              ? data.lastScanAt
                ? `Last scanned ${new Date(data.lastScanAt).toLocaleString()}`
                : "Never scanned"
              : ""}
          </span>
        </div>

        <p className="text-xs text-ink-muted">
          A scan looks at your most recent inbox and sent threads from the last 14 days (up to 40 of each) and re-checks
          up to 25 loops you already have. Anything older or buried deeper is not seen, and a loop that stops showing up
          is not treated as finished: it only closes when Gmail shows a reply.
        </p>

        {summary && (
          <p className="text-sm text-ink">
            Scan finished: {summary.created} new, {summary.resolved} closed, {summary.checked} re-checked. Looked at{" "}
            {summary.scanned.inboxThreads} inbox and {summary.scanned.sentThreads} sent threads.
            {summary.skippedAtLimit ? " Some new loops were not added because you have reached the limit." : ""}
          </p>
        )}

        {scanError && (
          <p className="text-sm text-danger">
            {scanError.message}{" "}
            {scanError.google && (
              <Link to="/app/settings" className="font-medium underline underline-offset-2">
                Open Settings
              </Link>
            )}
          </p>
        )}
      </div>

      {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {query.isError && <p className="text-sm text-danger">Could not load your open loops.</p>}

      {query.isSuccess && loops.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
          {data?.lastScanAt
            ? "Nothing looks unfinished in the threads Second could see."
            : "Press Scan inbox to look for threads that need your reply or are waiting on someone."}
        </p>
      )}

      {query.isSuccess && loops.length > 0 && open === 0 && (
        <p className="text-sm text-ink-muted">Nothing is open right now.</p>
      )}

      <Section
        title="Needs your reply"
        hint="Someone wrote to you last and you have not answered."
        loops={needsReply}
        today={today}
        busy={change.isPending}
        onAction={onAction}
      />
      <Section
        title="Waiting on them"
        hint="You wrote last and nobody has answered yet."
        loops={waitingOn}
        today={today}
        busy={change.isPending}
        onAction={onAction}
      />
      <Section title="Snoozed" loops={snoozed} today={today} busy={change.isPending} onAction={onAction} />

      {closed.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-xs font-medium tracking-wide text-ink-muted uppercase">
            Recently closed ({closed.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {closed.map((l) => (
              <Row
                key={l.id}
                loop={l}
                today={today}
                busy={change.isPending}
                onAction={(action) => onAction(l.id, action)}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}