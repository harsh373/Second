import { useState } from "react";
import { ApiError } from "../api/client";
import { debugAvailability, debugConflicts, debugEvent, debugEvents } from "../api/calendar.api";
import { debugByPerson, debugGetThread, debugSearchThreads, debugUnanswered } from "../api/gmail.api";

interface Field {
  name: string;
  placeholder: string;
}

function Panel({
  title,
  fields,
  run,
}: {
  title: string;
  fields: Field[];
  run: (values: Record<string, string>) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setFailed(false);
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    try {
      setResult(JSON.stringify(await run(clean), null, 2));
    } catch (err) {
      setFailed(true);
      setResult(
        err instanceof ApiError ? `${err.status} ${err.code ?? ""}: ${err.message}` : String(err),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">
        {fields.map((f) => (
          <input
            key={f.name}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            placeholder={f.placeholder}
            className="w-52 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        ))}
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="cursor-pointer rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? "Running..." : "Run"}
        </button>
      </div>
      {result && (
        <pre
          className={`max-h-96 overflow-auto rounded-lg p-3 text-xs ${failed ? "bg-danger-soft text-danger" : "bg-paper-dark text-ink"}`}
        >
          {result}
        </pre>
      )}
    </section>
  );
}

export default function GoogleDebug() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">Google debug</h1>
        <p className="text-sm text-ink-muted">
          Development only. Raw JSON from the live Gmail and Calendar endpoints. Dates: YYYY-MM-DD or ISO with
          offset. Empty fields use server defaults.
        </p>
      </div>

      <Panel
        title="Gmail: search threads"
        fields={[
          { name: "q", placeholder: "q (Gmail query)" },
          { name: "maxResults", placeholder: "maxResults" },
          { name: "pageToken", placeholder: "pageToken" },
        ]}
        run={debugSearchThreads}
      />
      <Panel
        title="Gmail: get thread"
        fields={[{ name: "threadId", placeholder: "threadId" }]}
        run={(v) => debugGetThread(v.threadId ?? "")}
      />
      <Panel
        title="Gmail: by person"
        fields={[{ name: "person", placeholder: "email or name" }]}
        run={debugByPerson}
      />
      <Panel
        title="Gmail: unanswered"
        fields={[
          { name: "sinceDays", placeholder: "sinceDays (14)" },
          { name: "waitingDays", placeholder: "waitingDays (3)" },
        ]}
        run={debugUnanswered}
      />
      <Panel
        title="Calendar: events"
        fields={[
          { name: "from", placeholder: "from" },
          { name: "to", placeholder: "to" },
          { name: "calendarId", placeholder: "calendarId (primary)" },
        ]}
        run={debugEvents}
      />
      <Panel
        title="Calendar: get event"
        fields={[{ name: "eventId", placeholder: "eventId" }]}
        run={(v) => debugEvent(v.eventId ?? "")}
      />
      <Panel
        title="Calendar: availability"
        fields={[
          { name: "from", placeholder: "from" },
          { name: "to", placeholder: "to" },
          { name: "minMinutes", placeholder: "minMinutes (30)" },
          { name: "workStart", placeholder: "workStart (e.g. 9)" },
          { name: "workEnd", placeholder: "workEnd (e.g. 18)" },
        ]}
        run={debugAvailability}
      />
      <Panel
        title="Calendar: conflicts"
        fields={[
          { name: "from", placeholder: "from" },
          { name: "to", placeholder: "to" },
        ]}
        run={debugConflicts}
      />
    </div>
  );
}