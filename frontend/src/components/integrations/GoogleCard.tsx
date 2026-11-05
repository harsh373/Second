import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarDays, Check, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import {
  completeGoogleConnect,
  disconnectGoogle,
  integrationsQueryOptions,
  startGoogleConnect,
  verifyGoogle,
} from "../../api/integrations.api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Dialog } from "../ui/Dialog";
import { ErrorState } from "../ui/ErrorState";
import { Skeleton, Spinner } from "../ui/Loading";
import { toast } from "../ui/Toast";
import { cn } from "../../utility/cn";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

function PermissionRow({
  icon,
  title,
  text,
  granted,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  granted?: boolean; // undefined = just informational (not connected yet)
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-ink-muted">{text}</p>
      </div>
      {granted !== undefined && (
        <span
          className={cn(
            "mt-0.5 inline-flex items-center gap-1 text-xs font-medium",
            granted ? "text-success" : "text-warning",
          )}
        >
          {granted ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
          {granted ? "Granted" : "Not granted"}
        </span>
      )}
    </li>
  );
}

export function GoogleCard() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const handledCallback = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isPending, isError, error, refetch } = useQuery(integrationsQueryOptions);
  const google = data?.integrations.find((item) => item.provider === "google");

  const refreshList = () => queryClient.invalidateQueries({ queryKey: integrationsQueryOptions.queryKey });

  const connect = useMutation({
    mutationFn: startGoogleConnect,
    onSuccess: ({ url }) => {
      window.location.href = url; // hand the browser over to Google's consent screen
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const complete = useMutation({
    mutationFn: completeGoogleConnect,
    onSuccess: () => {
      toast.success("Google connected");
      void refreshList();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const verify = useMutation({
    mutationFn: verifyGoogle,
    onSuccess: (result) => toast.success(`Connection is working (${result.accountEmail})`),
    onError: (err) => {
      toast.error(errorMessage(err));
      void refreshList(); // the backend may have flagged the connection as needing a reconnect
    },
  });

  const disconnect = useMutation({
    mutationFn: disconnectGoogle,
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success("Google disconnected");
      void refreshList();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Google sends the user back here as /app/settings?code=...&state=... (or ?error=...).
  // The guard makes sure a code is used once, even when React StrictMode runs effects twice.
  const { mutate: completeConnect } = complete;
  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const googleError = params.get("error");
    if (!code && !googleError) return;
    if (handledCallback.current) return;
    handledCallback.current = true;

    setParams({}, { replace: true }); // remove the code from the address bar

    if (googleError) {
      toast.error(googleError === "access_denied" ? "Google access was not granted." : `Google error: ${googleError}`);
      return;
    }
    if (code && state) completeConnect({ code, state });
  }, [params, setParams, completeConnect]);

  const missingPermission = google && (!google.permissions.gmail || !google.permissions.calendar);

  let body: ReactNode;

  if (isPending) {
    body = (
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  } else if (isError) {
    body = <ErrorState title="Could not load integrations" description={error.message} onRetry={() => void refetch()} />;
  } else if (complete.isPending) {
    body = (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> Finishing your Google connection…
      </div>
    );
  } else if (!google) {
    body = (
      <>
        <p className="text-sm text-ink-muted">Connect Google so Second can understand your inbox and schedule.</p>
        <ul className="mt-5 space-y-4">
          <PermissionRow icon={<Mail className="size-4" />} title="Read your email" text="Gmail, read-only." />
          <PermissionRow icon={<CalendarDays className="size-4" />} title="Read your calendar" text="Google Calendar, read-only." />
          <PermissionRow icon={<UserRound className="size-4" />} title="Know which account is connected" text="Your Google email address." />
        </ul>
        <p className="mt-5 flex items-start gap-2 text-xs text-ink-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          Second cannot send, edit or delete anything. You can disconnect at any time.
        </p>
        <Button className="mt-6" loading={connect.isPending} onClick={() => connect.mutate()}>
          Connect Google
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-sm">
          Connected as <span className="font-medium">{google.accountEmail}</span>
        </p>

        {google.status === "needs_reconnect" && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Google access was revoked or expired. Reconnect to continue.
          </div>
        )}

        <ul className="mt-5 space-y-4">
          <PermissionRow icon={<Mail className="size-4" />} title="Gmail" text="Read-only." granted={google.permissions.gmail} />
          <PermissionRow icon={<CalendarDays className="size-4" />} title="Calendar" text="Read-only." granted={google.permissions.calendar} />
        </ul>

        {missingPermission && (
          <p className="mt-4 text-xs text-warning">
            You skipped some permissions on Google's screen. Reconnect and tick them to enable those features.
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {google.status === "needs_reconnect" || missingPermission ? (
            <Button loading={connect.isPending} onClick={() => connect.mutate()}>
              Reconnect Google
            </Button>
          ) : (
            <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
              Test connection
            </Button>
          )}
          <Button variant="ghost" onClick={() => setConfirmOpen(true)}>
            Disconnect
          </Button>
        </div>

        <Dialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Disconnect Google?"
          description="Second will lose access to your Gmail and Calendar, and the stored credentials are deleted."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Disconnect
              </Button>
            </>
          }
        />
      </>
    );
  }

  const badge = google
    ? google.status === "active"
      ? { text: "Connected", className: "bg-accent-soft text-success" }
      : { text: "Reconnect needed", className: "bg-danger-soft text-danger" }
    : null;

  return (
    <Card>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl">Google</h2>
        {badge && <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", badge.className)}>{badge.text}</span>}
      </div>
      {body}
    </Card>
  );
}
