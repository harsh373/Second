import { useQuery } from "@tanstack/react-query";
import { getReadiness } from "../../api/health.api";
import { cn } from "../../utility/cn";

export function SystemStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["health", "ready"],
    queryFn: getReadiness,
    refetchInterval: 30_000,
    retry: false,
  });

  const state = isPending ? "checking" : isError || data?.status !== "ok" ? "down" : "up";
  const label = { checking: "Checking systems…", up: "All systems normal", down: "Systems degraded" }[state];

  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted" role="status">
      <span
        className={cn(
          "size-2 rounded-full",
          state === "up" && "bg-success",
          state === "down" && "bg-danger",
          state === "checking" && "animate-pulse bg-warning",
        )}
        aria-hidden
      />
      {label}
    </div>
  );
}