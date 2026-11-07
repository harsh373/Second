import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatDue } from "../api/commitments.api";
import { deskQueryOptions, type DeskLoop } from "../api/desk.api";
import { meQueryOptions } from "../api/user.api";
import { cn } from "../utility/cn";

function formatTime(iso: string | number): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Section({
  title,
  total,
  shown,
  to,
  linkLabel,
  empty,
  children,
}: {
  title: string;
  total: number;
  shown: number;
  to: string;
  linkLabel: string;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          {title}
          {total > 0 ? ` (${total})` : ""}
        </h2>
        <Link to={to} className="text-xs text-accent hover:underline">
          {linkLabel}
        </Link>
      </div>
      {total === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">{children}</ul>
      )}
      {total > shown && (
        <p className="text-xs text-ink-muted">
          Showing {shown} of {total}.
        </p>
      )}
    </section>
  );
}

function Row({ title, detail, aside }: { title: string; detail?: string | null; aside?: ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm break-words text-ink">{title}</p>
        {detail && <p className="mt-0.5 text-xs break-words text-ink-muted">{detail}</p>}
      </div>
      {aside && <div className="shrink-0 text-xs">{aside}</div>}
    </li>
  );
}

function GmailLink({ url }: { url: string }) {
  if (!url.startsWith("https://mail.google.com/")) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
    >
      Open <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function loopRow(l: DeskLoop, kind: "needs_reply" | "waiting_on") {
  const who = l.counterpart ? `${kind === "needs_reply" ? "From" : "To"} ${l.counterpart} · ` : "";
  return (
    <Row
      key={l.id}
      title={l.subject}
      detail={`${who}${plural(l.daysSince, "day")} since the last message`}
      aside={<GmailLink url={l.sourceUrl} />}
    />
  );
}

export default function Desk() {
  const { data: me } = useQuery(meQueryOptions);
  const desk = useQuery(deskQueryOptions);
  const firstName = me?.user.fullName?.split(" ")[0];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const d = desk.data;
  const loopTotal = d ? d.loops.needsReplyTotal + d.loops.waitingOnTotal : 0;
  const loopShown = d ? d.loops.needsReply.length + d.loops.waitingOn.length : 0;

  return (
    <div className="mx-auto max-w-3xl animate-rise space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-4xl tracking-tight">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-ink-muted">
          This page shows what Second has saved. It does not read Gmail or your calendar, and nothing here updates by
          itself. Open loops are as fresh as your last scan.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void desk.refetch()}
            disabled={desk.isFetching}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-paper-dark hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", desk.isFetching && "animate-spin")} aria-hidden />
            Reload
          </button>
          {desk.dataUpdatedAt > 0 && (
            <span className="text-xs text-ink-muted">Loaded {formatTime(desk.dataUpdatedAt)}</span>
          )}
        </div>
      </header>

      {desk.isLoading && <p className="text-sm text-ink-muted">Loading...</p>}
      {desk.isError && (
        <p className="text-sm text-danger">
          {desk.error instanceof Error ? desk.error.message : "Could not load your desk."}
        </p>
      )}

      {d && (
        <>
          <Section
            title="Waiting for you"
            total={d.approvals.total}
            shown={d.approvals.items.length}
            to="/app/actions"
            linkLabel="Open Action Center"
            empty="Nothing waiting for your approval."
          >
            {d.approvals.items.map((a) => (
              <Row
                key={a.id}
                title={a.title}
                detail={[a.detail, `Expires ${formatTime(a.expiresAt)}`].filter(Boolean).join(" · ")}
                aside={
                  a.blocked ? (
                    <span className="text-danger">No active delegation, Approve will be refused</span>
                  ) : undefined
                }
              />
            ))}
          </Section>

          <Section
            title="Commitments overdue or due within 7 days"
            total={d.commitments.total}
            shown={d.commitments.items.length}
            to="/app/commitments"
            linkLabel="Open Commitments"
            empty="Nothing overdue or due in the next 7 days."
          >
            {d.commitments.items.map((c) => (
              <Row
                key={c.id}
                title={c.title}
                detail={c.status === "waiting" ? `Waiting${c.waitingOn ? ` on ${c.waitingOn}` : ""}` : null}
                aside={
                  <span className="flex flex-col items-end gap-0.5">
                    <span className={cn("text-ink-muted", c.overdue && "font-medium text-danger")}>
                      {c.overdue ? "Overdue · " : "Due "}
                      {formatDue(c.dueDate)}
                    </span>
                    {c.band && <span className="text-ink-muted">{c.band} priority</span>}
                  </span>
                }
              />
            ))}
          </Section>

          <Section
            title="Open loops"
            total={loopTotal}
            shown={loopShown}
            to="/app/open-loops"
            linkLabel="Open Open loops"
            empty={
              d.loops.lastScanAt
                ? "No saved open loop needs attention."
                : "You have not scanned your inbox yet. Press Scan inbox on the Open loops page."
            }
          >
            {d.loops.needsReply.length > 0 && (
              <li className="space-y-2">
                <p className="text-xs font-medium text-ink">
                  You owe a reply ({d.loops.needsReplyTotal}
                  {d.loops.needsReplyTotal > d.loops.needsReply.length ? `, oldest ${d.loops.needsReply.length} shown` : ""})
                </p>
                <ul className="space-y-2">{d.loops.needsReply.map((l) => loopRow(l, "needs_reply"))}</ul>
              </li>
            )}
            {d.loops.waitingOn.length > 0 && (
              <li className="space-y-2">
                <p className="text-xs font-medium text-ink">
                  You are waiting on them ({d.loops.waitingOnTotal}
                  {d.loops.waitingOnTotal > d.loops.waitingOn.length ? `, oldest ${d.loops.waitingOn.length} shown` : ""})
                </p>
                <ul className="space-y-2">{d.loops.waitingOn.map((l) => loopRow(l, "waiting_on"))}</ul>
              </li>
            )}
          </Section>
          <p className="-mt-6 text-xs text-ink-muted">
            {d.loops.lastScanAt ? `Last inbox scan: ${formatTime(d.loops.lastScanAt)}.` : "Inbox never scanned."}
            {d.loops.snoozedHidden > 0 ? ` ${plural(d.loops.snoozedHidden, "snoozed loop")} not shown.` : ""}
          </p>

          <Section
            title="Delegations to review soon"
            total={d.delegations.total}
            shown={d.delegations.items.length}
            to="/app/delegations"
            linkLabel="Open Delegations"
            empty="No delegation reaches its review date in the next 7 days."
          >
            {d.delegations.items.map((x) => (
              <Row
                key={x.id}
                title={x.responsibility}
                detail={`${x.status === "paused" ? "Paused · " : ""}Review by ${x.reviewAt}`}
                aside={
                  <span className="text-ink-muted">
                    {x.daysLeft === 0 ? "Expires today" : `${plural(x.daysLeft, "day")} left`}
                  </span>
                }
              />
            ))}
          </Section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-medium tracking-wide text-ink-muted uppercase">Latest saved briefing</h2>
              <Link to="/app/briefings" className="text-xs text-accent hover:underline">
                Open Briefings
              </Link>
            </div>
            {d.briefing ? (
              <ul>
                <Row
                  title={d.briefing.title}
                  detail={`Generated ${formatTime(d.briefing.generatedAt)}. A snapshot, not live.`}
                />
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-muted">
                No briefing generated yet. Create one on the Briefings page.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}