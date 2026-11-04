import type { HTMLAttributes } from "react";
import { cn } from "../../utility/cn";

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface p-6 shadow-sm", className)} {...props}>
      {children}
    </div>
  );
}