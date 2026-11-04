import { Menu } from "lucide-react";
import { SystemStatus } from "./SystemStatus";

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-paper/90 px-5 backdrop-blur sm:px-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation"
          className="cursor-pointer rounded-lg p-1.5 text-ink-muted hover:bg-paper-dark lg:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <span className="text-sm text-ink-muted">{today}</span>
      </div>
      <SystemStatus />
    </header>
  );
}