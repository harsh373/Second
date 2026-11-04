import type { ReactNode } from "react";

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1 text-xs text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}