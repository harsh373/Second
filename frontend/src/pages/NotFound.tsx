import { Link } from "react-router-dom";
import { buttonClasses } from "../components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 font-display text-5xl tracking-tight">Page not found</h1>
      <p className="mt-3 text-ink-muted">That page does not exist.</p>
      <Link to="/" className={buttonClasses("primary", "md", "mt-8")}>
        Back home
      </Link>
    </div>
  );
}