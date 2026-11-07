import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/Toast";
import {
  approvalsQueryOptions,
  approveApproval,
  proposeSend,
  rejectApproval,
  type ApprovalStatus,
  type ApprovalView,
} from "../api/approvals.api";

const STATUS_STYLE: Record<ApprovalStatus, string> = {
  pending: "bg-accent-soft text-accent",
  executing: "bg-paper-dark text-ink-muted",
  executed: "bg-accent-soft text-accent",
  failed: "bg-danger-soft text-danger",
  rejected: "bg-paper-dark text-ink-muted",
  expired: "bg-paper-dark text-ink-muted",
};

const EVENT_TEXT: Record<string, string> = {
  created: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired (not approved in time)",
  executing: "Started",
  executed: "Done and verified",
  failed: "Failed",
};

const PRIMARY_BUTTON =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_BUTTON =
  "cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-paper-dark hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function labelOf(a: ApprovalView): string {
  if (a.send) return "Send an email";
  if (a.draft) return "Reply draft";
  return "Track a commitment";
}

function MessageBox({ to, subject, body }: { to: string; subject: string; body: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
      <p>
        <span className="text-ink-muted">To: </span>
        <span className="font-medium text-ink">{to}</span>
      </p>
      <p>
        <span className="text-ink-muted">Subject: </span>
        <span className="text-ink">{subject}</span>
      </p>
      <p className="border-t border-line pt-2 whitespace-pre-wrap text-ink">{body}</p>
    </div>
  );
}

function SendState({ a, busy, onSend }: { a: ApprovalView; busy: boolean; onSend: (draftApprovalId: string) => void }) {
  const s = a.sendOfDraft;

  if (s && s.status === "pending") {
    return (
      <p className="text-sm text-ink-muted">
        A send request for this draft is waiting under "Waiting for you". Read it there and approve or reject it.
      </p>
    );
  }
  if (s && s.status === "executing") return <p className="text-sm text-ink-muted">Sending...</p>;
  if (s && s.status === "executed") {
    return <p className="text-sm text-ink-muted">This email was sent and confirmed in Gmail.</p>;
  }

  return (
    <div className="space-y-2">
      {s && s.status === "failed" && (
        <p className="text-sm text-danger">
          The last send attempt failed. Open your Gmail Sent folder first: if the email is there, it was sent. Read the
          message on the send record below. If the draft is still in your Drafts folder, it was not sent and you can try
          again.
        </p>
      )}
      <button type="button" className={SMALL_BUTTON} disabled={busy} onClick={() => onSend(a.id)}>
        {s && s.status === "failed" ? "Try sending again" : "Send this email"}
      </button>
      <p className="text-xs text-ink-muted">
        This does not send anything yet. It creates a send request that you must read and approve once more.
      </p>
    </div>
  );
}

function ApprovalRow({
  a,
  busy,
  onApprove,
  onReject,
  onSend,
}: {
  a: ApprovalView;
  busy: boolean;
  onApprove: (a: ApprovalView) => void;
  onReject: (id: string) => void;
  onSend: (draftApprovalId: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <li className="space-y-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{labelOf(a)}</p>
          {a.commitment && (
            <>
              <p className="text-sm font-medium text-ink">{a.commitment.title}</p>
              <p className="text-xs text-ink-muted">
                Due: {a.commitment.dueDate ?? "no date"} · Impact: {a.commitment.impact}
              </p>
            </>
          )}
          {a.draft && <MessageBox to={a.draft.to} subject={a.draft.subject} body={a.draft.body} />}
          {a.send && <MessageBox to={a.send.to} subject={a.send.subject} body={a.send.body} />}
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[a.status]}`}>
          {a.status}
        </span>
      </div>

      {a.reason && <p className="text-sm text-ink-muted">Why: {a.reason}</p>}
      {a.sourceUrl && (
        <a
          href={a.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-block text-sm text-accent underline underline-offset-2"
        >
          {a.draft || a.send ? "Open the email thread" : "Open the source"}
        </a>
      )}

      {a.status === "pending" && (
        <div className="space-y-2">
          {a.draft && (
            <p className="text-xs text-ink-muted">
              Approving creates this as a draft in your Gmail Drafts folder. Nothing is sent. The app picked the
              recipient and subject from the email thread, not the AI. Check them before you approve.
            </p>
          )}
          {a.send && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              Approving SENDS this email now, to the recipient above. A sent email cannot be taken back. Before it is
              sent, the app re-reads the draft from Gmail and refuses to send if the recipient, subject or text is not
              exactly what you see here.
            </p>
          )}
          {a.delegation ? (
            <div className="rounded-lg bg-paper px-3 py-2 text-xs text-ink-muted">
              <p>Allowed by your delegation: {a.delegation.responsibility}</p>
              <p>Scope: {a.delegation.scope}</p>
              {a.delegation.restrictions.length > 0 && <p>Never: {a.delegation.restrictions.join("; ")}</p>}
              <p>The app checks that this delegation is active. You check that this proposal fits its scope.</p>
            </div>
          ) : (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              No active delegation allows this right now, so Approve will be refused. Create or resume one on the
              Delegations page.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => onApprove(a)}>
              {a.send ? "Approve and send" : a.draft ? "Approve and create draft" : "Approve"}
            </button>
            <button type="button" className={SMALL_BUTTON} disabled={busy} onClick={() => onReject(a.id)}>
              Reject
            </button>
            <span className="text-xs text-ink-muted">Expires {new Date(a.expiresAt).toLocaleString()}</span>
          </div>
        </div>
      )}

      {a.status === "failed" && a.errorMessage && <p className="text-sm text-danger">{a.errorMessage}</p>}
      {a.status === "executed" && a.commitment && (
        <p className="text-sm text-ink-muted">
          Created and read back from the database to verify it.{" "}
          <Link to="/app/commitments" className="text-accent underline underline-offset-2">
            Open Commitments
          </Link>
        </p>
      )}
      {a.status === "executed" && a.draft && (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">
            Draft created in Gmail and read back from Gmail to verify it. It is waiting in the email thread and in your
            Drafts folder. It has not been sent.
          </p>
          <SendState a={a} busy={busy} onSend={onSend} />
        </div>
      )}
      {a.status === "executed" && a.send && (
        <p className="text-sm text-ink-muted">
          Email sent. It was read back from Gmail and carries the SENT label. It is in your Sent folder and in the
          thread.
        </p>
      )}

      <button type="button" className={SMALL_BUTTON} onClick={() => setShowHistory((v) => !v)}>
        {showHistory ? "Hide history" : "History"}
      </button>
      {showHistory && (
        <ul className="space-y-1 text-xs text-ink-muted">
          {a.events.map((e, i) => (
            <li key={`${e.type}-${e.at}-${i}`}>
              {EVENT_TEXT[e.type] ?? e.type} · {new Date(e.at).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Actions() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery(approvalsQueryOptions);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["approvals"] });
    void qc.invalidateQueries({ queryKey: ["commitments"] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => approveApproval(id),
    onSuccess: (res) => {
      const a = res.approval;
      if (a.status === "executed") {
        toast.success(
          a.send
            ? "Email sent and verified in Gmail."
            : a.draft
              ? "Draft created in Gmail and verified."
              : "Commitment created and verified.",
        );
      } else {
        toast.error(a.errorMessage ?? "The action did not complete.");
      }
      refresh();
    },
    onError: (err) => {
      toast.error(messageOf(err));
      refresh();
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => rejectApproval(id),
    onSuccess: refresh,
    onError: (err) => {
      toast.error(messageOf(err));
      refresh();
    },
  });

  const send = useMutation({
    mutationFn: (draftApprovalId: string) => proposeSend(draftApprovalId),
    onSuccess: (res) => {
      toast.success(
        res.duplicate
          ? "A send request for this draft already exists."
          : "Send request created. Read it under Waiting for you, then approve it.",
      );
      refresh();
    },
    onError: (err) => {
      toast.error(messageOf(err));
      refresh();
    },
  });

  function handleApprove(a: ApprovalView) {
    if (a.send && !window.confirm(`Send this email to ${a.send.to} now? A sent email cannot be taken back.`)) return;
    approve.mutate(a.id);
  }

  const busy = approve.isPending || reject.isPending || send.isPending;
  const pending = data?.approvals.filter((a) => a.status === "pending") ?? [];
  const history = data?.approvals.filter((a) => a.status !== "pending") ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-4xl">Action Center</h1>
        <p className="text-ink-muted">
          Second can propose actions. Nothing runs until you read the exact proposal and press Approve. Every step is
          recorded.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-accent-soft px-4 py-3 text-sm text-ink">
        Three actions exist: tracking a commitment, creating a reply draft in your Gmail Drafts folder, and sending a
        draft you already created. Second can only propose the first two. To send, you press Send on a created draft,
        and then approve that send as a separate step. Proposals come from text in your email and calendar, which other
        people write, so read each one before approving. A proposal cannot be edited: reject it and ask again to change
        it.
      </div>

      {isLoading && <p className="text-sm text-ink-muted">Loading...</p>}
      {isError && <p className="text-sm text-danger">{messageOf(error)}</p>}

      {data && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-ink">Waiting for you</h2>
          {pending.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Nothing waiting. In Chat, ask Second to draft a reply to an email, or to look through a thread for things
              you promised.
            </p>
          ) : (
            <ul className="space-y-3">
              {pending.map((a) => (
                <ApprovalRow
                  key={a.id}
                  a={a}
                  busy={busy}
                  onApprove={handleApprove}
                  onReject={(id) => reject.mutate(id)}
                  onSend={(id) => send.mutate(id)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {data && history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-ink">History</h2>
          <ul className="space-y-3">
            {history.map((a) => (
              <ApprovalRow
                key={a.id}
                a={a}
                busy={busy}
                onApprove={handleApprove}
                onReject={(id) => reject.mutate(id)}
                onSend={(id) => send.mutate(id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}