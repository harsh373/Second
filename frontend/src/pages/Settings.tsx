import { GoogleCard } from "../components/integrations/GoogleCard";

export default function Settings() {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl tracking-tight">Settings</h1>
      <p className="mt-2 text-ink-muted">Control what Second can see.</p>

      <h2 className="mt-10 mb-4 text-sm font-medium tracking-wide text-ink-muted uppercase">Integrations</h2>
      <GoogleCard />
    </div>
  );
}