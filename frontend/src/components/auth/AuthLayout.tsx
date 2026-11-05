import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-paper px-4 py-10">
      <Link to="/" className="font-display text-3xl tracking-tight">
        Second
      </Link>
      {children}
    </div>
  );
}