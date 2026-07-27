import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-[18px] [&_svg]:w-[18px]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-white shadow-sm hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]",
        outline:
          "border border-[var(--color-border)] bg-white text-[var(--color-text)] hover:bg-neutral-50",
        ghost: "text-primary hover:bg-[var(--color-primary-light)]",
        link: "text-primary underline-offset-4 hover:underline",
        danger:
          "border border-danger-500 bg-white text-danger-600 hover:bg-danger-50",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-11 px-5",
        lg: "h-11 px-5",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
