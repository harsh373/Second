import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import {
  meQueryOptions,
  saveProfile,
  type CommunicationStyle,
  type UserType,
} from "../api/user.api";
import { Button, buttonClasses } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { toast } from "../components/ui/Toast";
import { cn } from "../utility/cn";

const USER_TYPES: { value: UserType; title: string; text: string }[] = [
  { value: "student", title: "Student", text: "Classes, deadlines, projects and campus life." },
  { value: "builder", title: "Independent builder", text: "Shipping products, clients and side projects." },
  { value: "other", title: "Something else", text: "Work and life that fits neither." },
];

const STYLES: { value: CommunicationStyle; title: string; text: string }[] = [
  { value: "concise", title: "Concise", text: "Short and direct. Just what matters." },
  { value: "detailed", title: "Detailed", text: "Fuller context and reasoning." },
];

function getTimezones(current: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(current) ? zones : [current, ...zones];
}

function Choice({
  selected,
  onSelect,
  title,
  text,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "cursor-pointer rounded-xl border p-4 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-paper-dark",
      )}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-1 block text-xs text-ink-muted">{text}</span>
    </button>
  );
}

export default function Onboarding() {
  const queryClient = useQueryClient();
  const { data: me } = useQuery(meQueryOptions);

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [fullName, setFullName] = useState(me?.user.fullName ?? "");
  const [timezone, setTimezone] = useState(me?.onboarded ? me.preferences.timezone : browserTimezone);
  const [userType, setUserType] = useState<UserType | null>(me?.preferences.userType ?? null);
  const [style, setStyle] = useState<CommunicationStyle>(me?.preferences.communicationStyle ?? "concise");
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: saveProfile,
    onSuccess: (data) => {
      queryClient.setQueryData(meQueryOptions.queryKey, data);
      setDone(true);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save your profile"),
  });

  if (!me) return null;

  if (done) {
    const firstName = fullName.trim().split(" ")[0];
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper px-4">
        <div className="max-w-md animate-rise text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
            <CheckCircle2 className="size-7" aria-hidden />
          </div>
          <h1 className="font-display text-4xl tracking-tight">You're all set, {firstName}.</h1>
          <p className="mt-3 text-ink-muted">Your office is ready. Second will learn the rest as we connect your world.</p>
          <Link to="/app" className={buttonClasses("primary", "lg", "mt-8")}>
            Enter your office
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!userType) return;
    save.mutate({ fullName: fullName.trim(), timezone, userType, communicationStyle: style });
  };

  const canSubmit = fullName.trim().length > 0 && userType !== null;

  return (
    <div className="min-h-dvh bg-paper px-4 py-12">
      <form onSubmit={onSubmit} className="mx-auto max-w-xl animate-rise">
        <p className="text-sm font-medium tracking-wide text-accent uppercase">Welcome to Second</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Let's set up your office</h1>
        <p className="mt-2 text-ink-muted">Three quick questions so Second works the way you do.</p>

        <Card className="mt-8 space-y-8">
          <Input
            label="What should Second call you?"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={80}
            placeholder="Your name"
          />

          <div>
            <p className="mb-2 text-sm font-medium">Which describes you best?</p>
            <div role="radiogroup" aria-label="Your role" className="grid gap-3 sm:grid-cols-3">
              {USER_TYPES.map((t) => (
                <Choice key={t.value} selected={userType === t.value} onSelect={() => setUserType(t.value)} title={t.title} text={t.text} />
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="timezone" className="mb-2 block text-sm font-medium">
              Your timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              {getTimezones(timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-muted">Detected from your browser. Briefings and reminders will follow this.</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">How should Second talk to you?</p>
            <div role="radiogroup" aria-label="Communication style" className="grid gap-3 sm:grid-cols-2">
              {STYLES.map((s) => (
                <Choice key={s.value} selected={style === s.value} onSelect={() => setStyle(s.value)} title={s.title} text={s.text} />
              ))}
            </div>
          </div>
        </Card>

        <Button type="submit" size="lg" className="mt-6 w-full" loading={save.isPending} disabled={!canSubmit}>
          Continue
        </Button>
      </form>
    </div>
  );
}