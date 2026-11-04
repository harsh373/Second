import { useState, type ReactNode } from "react";
import { Archive, Copy, Inbox, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Dropdown } from "../components/ui/Dropdown";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Input } from "../components/ui/Input";
import { Skeleton, Spinner } from "../components/ui/Loading";
import { toast } from "../components/ui/Toast";
import { Tooltip } from "../components/ui/Tooltip";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-sm font-medium tracking-wide text-ink-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

// Dev-only page to check every shared component in one place.
export default function Design() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl tracking-tight">Design system</h1>
      <p className="mt-2 text-ink-muted">Every shared component, in one place.</p>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Name" placeholder="Harsh" />
          <Input label="With hint" hint="Shown below the field" placeholder="you@example.com" />
          <Input label="With error" error="This field is required" defaultValue="oops" />
        </div>
      </Section>

      <Section title="Dialog, dropdown, tooltip, toasts">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Dropdown
            label="Actions"
            items={[
              { label: "Copy", icon: Copy, onSelect: () => toast.info("Copied (demo)") },
              { label: "Archive", icon: Archive, onSelect: () => toast.success("Archived (demo)") },
              { label: "Delete", icon: Trash2, danger: true, onSelect: () => toast.error("Deleted (demo)") },
            ]}
          />
          <Tooltip content="I am a tooltip">
            <Button variant="ghost">Hover or focus me</Button>
          </Tooltip>
          <Button variant="secondary" onClick={() => toast.success("Saved successfully")}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast.error("Something failed")}>
            Error toast
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Confirm action"
          description="Dialogs trap focus and close with Escape."
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setDialogOpen(false);
                  toast.success("Confirmed");
                }}
              >
                Confirm
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-muted">A native dialog element with custom styling.</p>
        </Dialog>
      </Section>

      <Section title="Cards and loading">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="font-medium">A card</h3>
            <p className="mt-1 text-sm text-ink-muted">Surface, border, soft shadow.</p>
          </Card>
          <Card className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
        </div>
      </Section>

      <Section title="Empty and error states">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <EmptyState icon={Inbox} title="Nothing here yet" description="This is what an empty list looks like." />
          </Card>
          <Card>
            <ErrorState onRetry={() => toast.info("Retry clicked")} />
          </Card>
        </div>
      </Section>
    </div>
  );
}