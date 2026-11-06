import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  addCommitment,
  commitmentsQueryOptions,
  deleteCommitment,
  formatDue,
  updateCommitment,
  type CommitmentItem,
  type CommitmentPatch,
  type CommitmentStatus,
  type Impact,
} from "../api/commitments.api";
import { toast } from "../components/ui/Toast";
import { cn } from "../utility/cn";

const STATUS_LABELS: Record<CommitmentStatus, string> = { open: "Open", waiting: "Waiting", done: "Done" };
const IMPACT_LABELS: Record<Impact, string> = { low: "Low impact", normal: "Normal impact", high: "High impact" };
const BAND_STYLES: Record<string, string> = {
  high: "bg-danger-soft text-danger",
  medium: "bg-warning/15 text-ink",
  low: "bg-paper-dark text-ink-muted",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function SourceLine({ c }: { c: CommitmentItem }): ReactNode {
  const s = c.source;
  if (!s) return "Source unknown";
  const date = formatDay(s.createdAt);
  if (s.type === "manual") return `Added by you · ${date}`;
  if (s.conversationId) {
    return (
      <>
        From{" "}
        <Link to={`/app/chat/${s.conversationId}`} className="text-accent underline-offset-2 hover:underline">
          a conversation
        </Link>{" "}
        · {date}
      </>
    );
  }
  return `From a conversation that was deleted · ${date}`;
}

const selectClass =
  "rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-accent";

function Row({
  c,
  today,
  onPatch,
  onDelete,
}: {
  c: CommitmentItem;
  today: string;
  onPatch: (patch: CommitmentPatch) => void;
  onDelete: () => void;
}) {
  const [why, setWhy] = useState(false);
  const done = c.status === "done";
  const overdue = !done && c.dueDate !== null && c.dueDate < today;
  const blockers = c.dependsOn.filter((d) => d.status !== "done");
  const waitingFor = c.dependents.filter((d) => d.status !== "done");

  return (
    <li className="space-y-2 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onPatch({ status: done ? "open" : "done" })}
          aria-label={done ? "Reopen" : "Mark done"}
          className={cn(
            "mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border",
            done ? "border-accent bg-accent text-white" : "border-ink-muted hover:border-accent",
          )}
        >
          {done && <Check className="size-3" aria-hidden />}
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("text-sm break-words text-ink", done && "text-ink-muted line-through")}>{c.title}</p>

          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted">
            {c.dueDate && (
              <span className={cn(overdue && "font-medium text-danger")}>
                {overdue ? "Overdue · " : "Due "}
                {formatDue(c.dueDate)}
              </span>
            )}
            {c.status === "waiting" && <span>Waiting{c.waitingOn ? ` on ${c.waitingOn}` : ""}</span>}
            {blockers.length > 0 && <span>Blocked by: {blockers.map((b) => b.title).join(", ")}</span>}
            {waitingFor.length > 0 && <span>Unblocks: {waitingFor.map((b) => b.title).join(", ")}</span>}
          </p>

          <p className="text-xs text-ink-muted">
            <SourceLine c={c} />
          </p>
          {c.source?.excerpt && (
            <p className="text-xs break-words text-ink-muted italic">You said: “{c.source.excerpt}”</p>
          )}
        </div>

        {c.priority && (
          <button
            type="button"
            onClick={() => setWhy((v) => !v)}
            aria-expanded={why}
            className={cn(
              "shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium",
              BAND_STYLES[c.priority.band],
            )}
          >
            {c.priority.score} · {c.priority.band}
          </button>
        )}

        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete this commitment"
          className="shrink-0 cursor-pointer rounded-md p-1.5 text-ink-muted hover:text-danger"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      {why && c.priority && (
        <div className="rounded-lg bg-paper-dark px-3 py-2 text-xs">
          <p className="mb-1 font-medium text-ink">Why this priority?</p>
          <ul className="space-y-0.5">
            {c.priority.factors.map((f) => (
              <li key={f.key} className="flex gap-2 text-ink-muted">
                <span className="w-8 shrink-0 text-right font-medium text-ink">
                  {f.points > 0 ? `+${f.points}` : String(f.points)}
                </span>
                <span>
                  {f.label}: {f.detail}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-ink-muted">
            Total {c.priority.score}. Fixed rules, no AI guesswork: change the date or impact and the score follows.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pl-8">
        <select
          value={c.status}
          onChange={(e) => onPatch({ status: e.target.value as CommitmentStatus })}
          aria-label="Status"
          className={selectClass}
        >
          {(Object.keys(STATUS_LABELS) as CommitmentStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={c.impact}
          onChange={(e) => onPatch({ impact: e.target.value as Impact })}
          aria-label="Impact"
          className={selectClass}
        >
          {(Object.keys(IMPACT_LABELS) as Impact[]).map((i) => (
            <option key={i} value={i}>
              {IMPACT_LABELS[i]}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={c.dueDate ?? ""}
          onChange={(e) => onPatch({ dueDate: e.target.value || null })}
          aria-label="Due date"
          className={selectClass}
        />
      </div>
    </li>
  );
}

export default function Commitments() {
  const qc = useQueryClient();
  const query = useQuery(commitmentsQueryOptions);

  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [impact, setImpact] = useState<Impact>("normal");
  const [matter, setMatter] = useState("");

  const refresh = () => void qc.invalidateQueries({ queryKey: ["commitments"] });

  const add = useMutation({
    mutationFn: addCommitment,
    onSuccess: () => {
      setTitle("");
      setDue("");
      setMatter("");
      setImpact("normal");
      refresh();
      toast.success("Commitment added.");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add that commitment."),
  });

  const patch = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: CommitmentPatch }) => updateCommitment(id, changes),
    onSuccess: refresh,
    onError: () => toast.error("Could not update that commitment."),
  });

  const remove = useMutation({
    mutationFn: deleteCommitment,
    onSuccess: refresh,
    onError: () => toast.error("Could not delete that commitment."),
  });

  function confirmDelete(c: CommitmentItem) {
    if (!window.confirm(`Stop tracking this?\n\n${c.title}`)) return;
    remove.mutate(c.id);
  }

  const today = query.data?.today ?? "";
  const items = query.data?.commitments ?? [];
  const active = items.filter((c) => c.status !== "done");
  const finished = items.filter((c) => c.status === "done");

  // The server sends active items highest priority first, so groups appear in order of their top item.
  const groups = new Map<string, { title: string; items: CommitmentItem[] }>();
  for (const c of active) {
    const key = c.matter?.id ?? "none";
    const group = groups.get(key) ?? { title: c.matter?.title ?? "Not in a matter", items: [] };
    group.items.push(c);
    groups.set(key, group);
  }

  const renderRow = (c: CommitmentItem) => (
    <Row
      key={c.id}
      c={c}
      today={today}
      onPatch={(changes) => patch.mutate({ id: c.id, changes })}
      onDelete={() => confirmDelete(c)}
    />
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-4xl">Commitments</h1>
        <p className="text-sm text-ink-muted">
          Things you have said you must do, owe, or are waiting on. Second adds them when you state them in chat, and
          shows exactly where each one came from. It never adds anything from your email or calendar by itself.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = title.trim();
          if (!text || add.isPending) return;
          add.mutate({
            title: text,
            ...(due ? { dueDate: due } : {}),
            impact,
            ...(matter.trim() ? { matter: matter.trim() } : {}),
          });
        }}
        className="space-y-2 rounded-2xl border border-line bg-surface p-3"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          placeholder="Something you need to do or are waiting on"
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={matter}
            onChange={(e) => setMatter(e.target.value)}
            maxLength={60}
            placeholder="Matter (optional, e.g. DBMS exam)"
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
          />
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date"
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <select
            value={impact}
            onChange={(e) => setImpact(e.target.value as Impact)}
            aria-label="Impact"
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {(Object.keys(IMPACT_LABELS) as Impact[]).map((i) => (
              <option key={i} value={i}>
                {IMPACT_LABELS[i]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!title.trim() || add.isPending}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
            Add
          </button>
        </div>
      </form>

      {query.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {query.isError && <p className="text-sm text-danger">Could not load your commitments.</p>}

      {query.isSuccess && items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
          Nothing tracked yet. Tell Second in chat what you need to get done, for example &ldquo;I need to submit the
          assignment by Friday&rdquo;, or add one above.
        </p>
      )}

      {[...groups.entries()].map(([key, group]) => (
        <section key={key} className="space-y-2">
          <h2 className="text-xs font-medium tracking-wide text-ink-muted uppercase">{group.title}</h2>
          <ul className="space-y-2">{group.items.map(renderRow)}</ul>
        </section>
      ))}

      {finished.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-xs font-medium tracking-wide text-ink-muted uppercase">
            Done ({finished.length})
          </summary>
          <ul className="mt-2 space-y-2">{finished.map(renderRow)}</ul>
        </details>
      )}
    </div>
  );
}