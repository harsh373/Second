import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  description = "Please try again. If it keeps happening, check that the server is running.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <h3 className="font-display text-2xl">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">{description}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}