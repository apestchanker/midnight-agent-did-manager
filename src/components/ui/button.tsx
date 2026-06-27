import * as React from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

    const variants = {
      default: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
      outline:
        "border border-zinc-700 bg-transparent hover:bg-zinc-800 text-zinc-200",
      ghost: "hover:bg-zinc-800 text-zinc-200",
    };

    const sizes = {
      default: "px-4 py-2 text-sm",
      sm: "px-2 py-1 text-xs",
      lg: "px-6 py-3 text-base",
    };

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
