import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "../../lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, ...props }, ref) => (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        type="checkbox"
        ref={ref}
        checked={checked}
        className={cn(
          "peer sr-only",
          className
        )}
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white",
          "transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#146CE8]/30",
          "peer-checked:border-[#146CE8] peer-checked:bg-[#146CE8]",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
        )}
      >
        <Check
          className={cn(
            "h-3 w-3 text-white opacity-0 transition-opacity",
            checked && "opacity-100"
          )}
          strokeWidth={3}
        />
      </span>
    </span>
  )
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
