import { useSyncExternalStore } from "react";
import { CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "../../utility/cn";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

// A tiny module-level store, so any file can call toast.success("...") with no provider needed.
let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => toasts;

function dismiss(id: number) {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, durationMs = 4000) {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  emit();
  window.setTimeout(() => dismiss(id), durationMs);
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message, 6000),
  info: (message: string) => push("info", message),
};

const icons: Record<ToastKind, LucideIcon> = { success: CheckCircle2, error: XCircle, info: Info };
const iconColors: Record<ToastKind, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-ink-muted",
};

// Render once, near the root of the app.
export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100%-2rem))] flex-col gap-2"
    >
      {items.map((item) => {
        const Icon = icons[item.kind];
        return (
          <div
            key={item.id}
            className="pointer-events-auto flex animate-rise items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-lg"
          >
            <Icon className={cn("mt-0.5 size-5 shrink-0", iconColors[item.kind])} aria-hidden />
            <p className="flex-1 text-sm">{item.message}</p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="cursor-pointer text-xs text-ink-muted hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        );
      })}
    </div>
  );
}