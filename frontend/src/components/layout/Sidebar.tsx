import { Link, NavLink } from "react-router-dom";
import {
  Brain,
  Bug,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Newspaper,
  Palette,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../utility/cn";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

// Only features that exist get a link. Add entries as each feature ships.
const NAV_ITEMS: NavItem[] = [
  { to: "/app", label: "Desk", icon: LayoutDashboard, end: true },
  { to: "/app/chat", label: "Chat", icon: MessageSquare },
  { to: "/app/briefings", label: "Briefings", icon: Newspaper },
  { to: "/app/commitments", label: "Commitments", icon: ListChecks },
  { to: "/app/open-loops", label: "Open loops", icon: Inbox },
  { to: "/app/people", label: "People", icon: Users },
  { to: "/app/memory", label: "Memory", icon: Brain },
  { to: "/app/settings", label: "Settings", icon: Settings },
];
const DEV_ITEMS: NavItem[] = [
  { to: "/app/design", label: "Design system", icon: Palette },
  { to: "/app/dev/google", label: "Google debug", icon: Bug },
];

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate: () => void }) {
  return (
    <>
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-paper-dark hover:text-ink",
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-surface transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Link to="/" className="font-display text-2xl tracking-tight">
            Second
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="cursor-pointer rounded-lg p-1.5 text-ink-muted hover:bg-paper-dark lg:hidden"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-2" aria-label="Main">
          <NavLinks items={NAV_ITEMS} onNavigate={onClose} />
          {import.meta.env.DEV && (
            <>
              <p className="mt-6 px-3 text-xs font-medium tracking-wide text-ink-muted uppercase">Development</p>
              <NavLinks items={DEV_ITEMS} onNavigate={onClose} />
            </>
          )}
        </nav>
      </aside>
    </>
  );
}