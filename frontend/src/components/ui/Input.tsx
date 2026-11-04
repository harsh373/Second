import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "../../utility/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, id, className, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const descriptionId = `${inputId}-description`;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? descriptionId : undefined}
          className={cn(
            "h-10 rounded-lg border bg-surface px-3 text-sm text-ink transition-colors",
            "placeholder:text-ink-muted/70 disabled:opacity-50",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            error ? "border-danger" : "border-line hover:border-ink-muted/40",
            className,
          )}
          {...props}
        />
        {(error || hint) && (
          <p id={descriptionId} className={cn("text-xs", error ? "text-danger" : "text-ink-muted")}>
            {error ?? hint}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";