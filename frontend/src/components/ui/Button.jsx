import { cn } from "@/lib/utils";

// Buttons.
//
// Three variants, no more. Primary is the app's green — one per screen area,
// so it keeps meaning something. Transitions are colour-only and short; there
// are no transforms, scales, or slides anywhere in this app, which is what
// keeps it calm and what makes prefers-reduced-motion a one-line rule.

const VARIANTS = {
  primary:
    "bg-primary-600 hover:bg-primary-700 text-white border border-transparent",
  secondary:
    "bg-white hover:border-primary-300 text-neutral-700 border border-neutral-200",
  quiet:
    "bg-transparent hover:text-neutral-800 text-neutral-500 border border-transparent",
};

const SIZES = {
  sm: "px-3 py-1.5 text-sm rounded-md",
  md: "px-5 py-2.5 text-base rounded-lg",
};

export default function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  className = "",
  children,
  ...rest
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={size === "sm" ? 15 : 18} weight="regular" /> : null}
      {children}
    </button>
  );
}
