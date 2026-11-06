import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  deletePerson,
  peopleQueryOptions,
  refreshPeople,
  setPersonLabel,
  type Person,
} from "../api/people.api";
import { toast } from "../components/ui/Toast";
import { cn } from "../utility/cn";

const GMAIL_PREFIX = "https://mail.google.com/";
const SAVED_THREADS_CAP = 20;

function ago(iso: string | null): string {
  if (!iso) return "no email contact saved";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PersonRow({ person }: { person: Person }) {
  const qc = useQueryClient();
  const [showThreads, setShowThreads] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const title = person.name ?? person.email ?? "Unknown";
  const threadCount =
    person.interactionCount >= SAVED_THREADS_CAP ? `${SAVED_THREADS_CAP}+ threads` : `${person.interactionCount} thread${person.interactionCount === 1 ? "" : "s"}`;

  const saveLabel = useMutation({
    mutationFn: (label: string | null) => setPersonLabel(person.id, label),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["people"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save the relationship."),
  });

  const remove = useMutation({
    mutationFn: () => deletePerson(person.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["people"] }),
    onError: () => toast.error("Could not remove this person."),
  });

  function confirmRemove() {
    const message = person.email
      ? `Remove ${title}? Their saved threads and relationship are deleted, and Second will not add this email address again. This cannot be undone.`
      : `Delete ${title}? This cannot be undone.`;
    if (window.confirm(message)) remove.mutate();
  }

  function startEditing() {
    setDraft(person.relationship?.label ?? "");
    setEditing(true);
  }

  return (
    <li className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{title}</span>
            {person.relationship && (
              <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
                {person.relationship.label}
              </span>
            )}
            {person.openLoopCount > 0 && (
              <Link
                to="/app/open-loops"
                className="rounded-full bg-paper-dark px-2.5 py-0.5 text-xs font-medium text-ink-muted hover:text-ink"
              >
                {person.openLoopCount} open loop{person.openLoopCount === 1 ? "" : "s"}
              </Link>
            )}
          </div>

          {person.name && person.email && <p className="truncate text-xs text-ink-muted">{person.email}</p>}

          <p className="text-xs text-ink-muted">
            {person.lastContactAt
              ? `Last email ${ago(person.lastContactAt)} · ${person.lastDirection === "from" ? "they wrote last" : "you wrote last"} · ${threadCount}`
              : "Added from something you said in chat. No email contact saved."}
          </p>

          {person.relationship && (
            <p className="text-xs text-ink-muted">
              {person.relationship.source === "manual"
                ? "Relationship set by you."
                : person.relationship.excerpt
                  ? `You said: \u201C${person.relationship.excerpt}\u201D`
                  : "You said so in chat."}
            </p>
          )}

          {editing ? (
            <form
              className="flex flex-wrap items-center gap-2 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                saveLabel.mutate(draft.trim() === "" ? null : draft.trim());
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={60}
                autoFocus
                placeholder="For example: project partner"
                className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={saveLabel.isPending}
                className="cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Save
              </button>
              {person.relationship && (
                <button
                  type="button"
                  onClick={() => saveLabel.mutate(null)}
                  disabled={saveLabel.isPending}
                  className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-paper-dark disabled:opacity-50"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-paper-dark"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-xs font-medium">
              <button type="button" onClick={startEditing} className="cursor-pointer text-accent hover:underline">
                {person.relationship ? "Edit relationship" : "Set relationship"}
              </button>
              {person.interactions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowThreads((v) => !v)}
                  className="cursor-pointer text-accent hover:underline"
                >
                  {showThreads ? "Hide recent threads" : "Show recent threads"}
                </button>
              )}
            </div>
          )}

          {showThreads && (
            <ul className="space-y-1.5 border-t border-line pt-2">
              {person.interactions.map((t) => (
                <li key={t.threadId} className="flex items-start gap-2 text-xs text-ink-muted">
                  <span className="min-w-0 flex-1">
                    <span className="break-words text-ink">{t.subject}</span>
                    <span>
                      {" "}
                      · {shortDate(t.lastMessageAt)} · {t.direction === "from" ? "they wrote last" : "you wrote last"}
                      {t.openLoop === "needs_reply" && " · open loop: needs your reply"}
                      {t.openLoop === "waiting_on" && " · open loop: waiting on them"}
                    </span>
                  </span>
                  {t.sourceUrl.startsWith(GMAIL_PREFIX) && (
                    <a
                      href={t.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 font-medium text-accent hover:underline"
                    >
                      Open in Gmail
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={confirmRemove}
          disabled={remove.isPending}
          aria-label={`Remove ${title}`}
          className="cursor-pointer rounded-md p-1.5 text-ink-muted hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}

export default function People() {
  const qc = useQueryClient();
  const query = useQuery(peopleQueryOptions);

  const refresh = useMutation({
    mutationFn: refreshPeople,
    onSuccess: (s) => {
      const parts = [
        `Read ${s.threadsScanned} threads from the last ${s.sinceDays} days.`,
        `${s.added} new, ${s.updated} already known.`,
      ];
      if (s.skippedRemoved > 0) parts.push(`${s.skippedRemoved} removed people skipped.`);
      if (s.skippedLimit > 0) parts.push(`${s.skippedLimit} not added (people limit).`);
      if (s.capped) parts.push("Thread limit reached, so older threads may be missing.");
      toast.success(parts.join(" "));
      void qc.invalidateQueries({ queryKey: ["people"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not refresh people."),
  });

  const people = query.data?.people ?? [];
  const withRelationship = people.filter((p) => p.relationship);
  const others = people.filter((p) => !p.relationship);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-4xl">People</h1>
        <p className="text-sm text-ink-muted">
          The people you exchange email with, and people you tell Second about in chat. Email contacts come from Gmail
          headers only. Second never guesses how someone relates to you: a relationship appears only when you say so or
          set it here.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">Refresh from Gmail</p>
          <p className="text-xs text-ink-muted">
            Reads the last 30 days of threads (up to 100), skipping newsletters and no-reply senders. Stored: names,
            email addresses, thread subjects and links. Not stored: what the emails say. Nothing refreshes in the
            background.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", refresh.isPending && "animate-spin")} aria-hidden />
          {refresh.isPending ? "Reading Gmail…" : "Refresh people"}
        </button>
      </div>

      {query.isLoading && <p className="text-sm text-ink-muted">Loading people…</p>}
      {query.isError && <p className="text-sm text-danger">Could not load people.</p>}

      {query.isSuccess && people.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
          No people yet. Press Refresh people, or tell Second in chat, for example "Rahul is my project partner".
        </p>
      )}

      {withRelationship.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-ink-muted">Your people ({withRelationship.length})</h2>
          <ul className="space-y-2">
            {withRelationship.map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-ink-muted">Recent contacts ({others.length})</h2>
          <ul className="space-y-2">
            {others.map((p) => (
              <PersonRow key={p.id} person={p} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}