import { Inbox } from "lucide-react";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

export default function Desk() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl tracking-tight">{greeting}</h1>
      <p className="mt-2 text-ink-muted">Your desk, in one place.</p>

      <Card className="mt-8">
        <EmptyState
          icon={Inbox}
          title="Your desk is clear"
          description="Second does not know about your world yet. Email, calendar and tasks will appear here as those features are built."
        />
      </Card>
    </div>
  );
}