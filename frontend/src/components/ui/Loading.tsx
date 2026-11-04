import { Loader2 } from "lucide-react";
import { cn } from "../../utility/cn";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-ink-muted", className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-paper-dark", className)} aria-hidden />;
}