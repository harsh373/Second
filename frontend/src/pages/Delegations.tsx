import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/Toast";
import {
  changeDelegation,
  createDelegation,
  deleteDelegation,
  delegationsQueryOptions,
  type DelegationAction,
  type DelegationAuthority,
  type DelegationOptions,
  type DelegationTrigger,
  type DelegationView,
} from "../api/delegations.api";

const TRIGGER_TEXT: Record<DelegationTrigger, string> = {
  when_asked: "When I ask",
  new_email: "When a new email arrives",
  before_meeting: "Before a meeting",
  schedule: "On a schedule",
};

const AUTHORITY_TEXT: Record<DelegationAuthority, { label: string; help: string }> = {
  observe: {
    label: "Observe",
    help: "Second may look at the relevant information and tell you what it sees. It never acts.",
  },
  suggest: {
    label: "Suggest",
    help: "Second may propose what to do. You do everything yourself.",
  },
  execute_with_approval: {
    label: "Execute with approval",
    help: "Second may prepare an action, and it runs only after you approve that specific action.",
  },
  narrow_delegation: {
    label: "Narrow delegation",
    help: "Second may act without asking each time, only inside the scope, tools and restrictions below, until the review date.",
  },
};

const TOOL_TEXT: Record<string, string> = {
  gmail_create_draft: "Create a Gmail draft",
  gmail_send: "Send an email",
  gmail_archive: "Archive an email",
  gmail_label: "Label an email",
  calendar_create_event: "Create a calendar event",
  calendar_update_event: "Update a calendar event",
  calendar_cancel_event: "Cancel a calendar event",
  create_commitment: "Track a commitment",
  set_reminder: "Set a reminder",
};

const EVENT_TEXT: Record<string, string> = {
  created: "Created",
  paused: "Paused",
  resumed: "Resumed",
  revoked: "Revoked",
  expired: "Expired (review date passed)",
};

const STATUS_STYLE: Record<DelegationView["status"], string> = {
  active: "bg-accent-soft text-accent",
  paused: "bg-paper-dark text-ink-muted",
  revoked: "bg-danger-soft text-danger",
  expired: "bg-paper-dark text-ink-muted",
};

const PRIMARY_BUTTON =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_BUTTON =
  "cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-paper-dark hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";
const FIELD =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent";

function addDaysStr(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function DelegationRow({
  d,
  busy,
  onAction,
  onDelete,
}: {
  d: DelegationView;
  busy: boolean;
  onAction: (id: string, action: DelegationAction) => void;
  onDelete: (id: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const ended = d.status === "revoked" || d.status === "expired";

  return (
    <li className="space-y-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-ink">{d.responsibility}</p>
          <p className="text-sm text-ink-muted">Scope: {d.scope}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[d.status]}`}>
          {d.status}
        </span>
      </div>

      <div className="space-y-1 text-xs text-ink-muted">
        <p>
          {AUTHORITY_TEXT[d.authority].label} · {TRIGGER_TEXT[d.trigger]} · review by {d.reviewAt}
        </p>
        {d.tools.length > 0 && <p>Tools: {d.tools.map((t) => TOOL_TEXT[t] ?? t).join(", ")}</p>}
        {d.restrictions.length > 0 && (
          <div>
            <p>Never:</p>
            <ul className="ml-4 list-disc">
              {d.restrictions.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {d.status === "active" && (
          <button type="button" className={SMALL_BUTTON} disabled={busy} onClick={() => onAction(d.id, "pause")}>
            Pause
          </button>
        )}
        {d.status === "paused" && (
          <button type="button" className={SMALL_BUTTON} disabled={busy} onClick={() => onAction(d.id, "resume")}>
            Resume
          </button>
        )}
        {(d.status === "active" || d.status === "paused") && (
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={busy}
            onClick={() => {
              if (window.confirm("Revoke this delegation? This cannot be undone. You can create a new one later.")) {
                onAction(d.id, "revoke");
              }
            }}
          >
            Revoke
          </button>
        )}
        {ended && (
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={busy}
            onClick={() => {
              if (window.confirm("Delete this delegation record?")) onDelete(d.id);
            }}
          >
            Delete
          </button>
        )}
        <button type="button" className={SMALL_BUTTON} onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "Hide history" : "History"}
        </button>
      </div>

      {showHistory && (
        <ul className="space-y-1 text-xs text-ink-muted">
          {d.events.map((e, i) => (
            <li key={`${e.type}-${e.at}-${i}`}>
              {EVENT_TEXT[e.type] ?? e.type} · {new Date(e.at).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CreateForm({ today, options, onDone }: { today: string; options: DelegationOptions; onDone: () => void }) {
  const [responsibility, setResponsibility] = useState("");
  const [scope, setScope] = useState("");
  const [trigger, setTrigger] = useState<DelegationTrigger>("when_asked");
  const [authority, setAuthority] = useState<DelegationAuthority>("suggest");
  const [tools, setTools] = useState<string[]>([]);
  const [restrictionsText, setRestrictionsText] = useState("");
  const [reviewAt, setReviewAt] = useState("");

  const canExecute = authority === "execute_with_approval" || authority === "narrow_delegation";
  const maxDays = authority === "narrow_delegation" ? options.narrowMaxReviewDays : options.maxReviewDays;
  const restrictions = restrictionsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const create = useMutation({
    mutationFn: () => createDelegation({ responsibility, scope, trigger, authority, tools, restrictions, reviewAt }),
    onSuccess: () => {
      toast.success("Delegation saved. Nothing executes yet.");
      setResponsibility("");
      setScope("");
      setTrigger("when_asked");
      setAuthority("suggest");
      setTools([]);
      setRestrictionsText("");
      setReviewAt("");
      onDone();
    },
    onError: (err) => toast.error(messageOf(err)),
  });

  function chooseAuthority(next: DelegationAuthority) {
    setAuthority(next);
    if (next === "observe" || next === "suggest") setTools([]);
    if (next === "narrow_delegation") setTools((t) => t.filter((x) => !options.narrowBlockedTools.includes(x)));
  }

  function toggleTool(t: string) {
    setTools((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  const ready =
    responsibility.trim().length > 0 &&
    scope.trim().length > 0 &&
    reviewAt.length > 0 &&
    (!canExecute || tools.length > 0);

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-medium text-ink">New delegation</h2>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-muted">What should Second take care of?</span>
        <input
          className={FIELD}
          value={responsibility}
          maxLength={options.responsibilityMax}
          onChange={(e) => setResponsibility(e.target.value)}
          placeholder="Keep my internship emails from going unanswered"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-muted">Scope: where does this apply?</span>
        <textarea
          className={FIELD}
          rows={2}
          value={scope}
          maxLength={options.scopeMax}
          onChange={(e) => setScope(e.target.value)}
          placeholder="Only emails from recruiters about internships"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-muted">Trigger</span>
          <select className={FIELD} value={trigger} onChange={(e) => setTrigger(e.target.value as DelegationTrigger)}>
            {options.triggers.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_TEXT[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-muted">Authority level</span>
          <select
            className={FIELD}
            value={authority}
            onChange={(e) => chooseAuthority(e.target.value as DelegationAuthority)}
          >
            {options.authorities.map((a) => (
              <option key={a} value={a}>
                {AUTHORITY_TEXT[a].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-ink-muted">{AUTHORITY_TEXT[authority].help}</p>

      <fieldset className="space-y-2" disabled={!canExecute}>
        <legend className="text-xs font-medium text-ink-muted">
          Authorized tools {canExecute ? "" : "(Observe and Suggest never take action, so no tools)"}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.tools.map((t) => {
            const blocked = authority === "narrow_delegation" && options.narrowBlockedTools.includes(t);
            return (
              <label
                key={t}
                className={`flex items-center gap-2 text-sm ${canExecute && !blocked ? "text-ink" : "text-ink-muted opacity-60"}`}
              >
                <input
                  type="checkbox"
                  checked={tools.includes(t)}
                  disabled={!canExecute || blocked}
                  onChange={() => toggleTool(t)}
                />
                {TOOL_TEXT[t] ?? t}
                {blocked && <span className="text-xs">(always needs approval)</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-muted">
          Restrictions: things Second must never do (one per line, up to {options.restrictionsMaxCount})
        </span>
        <textarea
          className={FIELD}
          rows={3}
          value={restrictionsText}
          onChange={(e) => setRestrictionsText(e.target.value)}
          placeholder={"Never reply to anyone from my college\nNever mention my location"}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-muted">
          Review date: the delegation expires on this date (up to {maxDays} days ahead)
        </span>
        <input
          type="date"
          className={FIELD}
          value={reviewAt}
          min={addDaysStr(today, 1)}
          max={addDaysStr(today, maxDays)}
          onChange={(e) => setReviewAt(e.target.value)}
        />
      </label>

      <button type="button" className={PRIMARY_BUTTON} disabled={!ready || create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? "Saving..." : "Save delegation"}
      </button>
    </div>
  );
}

export default function Delegations() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery(delegationsQueryOptions);

  const refresh = () => qc.invalidateQueries({ queryKey: ["delegations"] });

  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: DelegationAction }) => changeDelegation(id, action),
    onSuccess: refresh,
    onError: (err) => {
      toast.error(messageOf(err));
      void refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDelegation(id),
    onSuccess: refresh,
    onError: (err) => toast.error(messageOf(err)),
  });

  const busy = change.isPending || remove.isPending;
  const current = data?.delegations.filter((d) => d.status === "active" || d.status === "paused") ?? [];
  const past = data?.delegations.filter((d) => d.status === "revoked" || d.status === "expired") ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">Delegations</h1>
        <p className="text-ink-muted">
          What you authorize Second to take care of: the responsibility, how far it may go, which tools, what it must
          never do, and when you will review it. You can revoke any delegation at any time.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-accent-soft px-4 py-3 text-sm text-ink">
        Nothing executes yet. Second cannot send, draft, schedule or change anything today. These are the saved rules
        that future actions will have to follow. Permission is decided by the app, never by the AI, and only on this
        page: what you say in chat never creates or widens a delegation.
      </div>

      {isLoading && <p className="text-sm text-ink-muted">Loading...</p>}
      {isError && <p className="text-sm text-danger">{messageOf(error)}</p>}

      {data && <CreateForm today={data.today} options={data.options} onDone={() => void refresh()} />}

      {data && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-ink">Active and paused</h2>
          {current.length === 0 ? (
            <p className="text-sm text-ink-muted">No delegations yet.</p>
          ) : (
            <ul className="space-y-3">
              {current.map((d) => (
                <DelegationRow
                  key={d.id}
                  d={d}
                  busy={busy}
                  onAction={(id, action) => change.mutate({ id, action })}
                  onDelete={(id) => remove.mutate(id)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {data && past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-ink">Revoked and expired</h2>
          <ul className="space-y-3">
            {past.map((d) => (
              <DelegationRow
                key={d.id}
                d={d}
                busy={busy}
                onAction={(id, action) => change.mutate({ id, action })}
                onDelete={(id) => remove.mutate(id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}