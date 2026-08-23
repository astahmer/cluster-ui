import { cva, type VariantProps } from "class-variance-authority"
import { clsx, type ClassValue } from "clsx"
import * as React from "react"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ---------------------------------- button --------------------------------- */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent/85",
        secondary: "bg-surface-2 text-text border border-border hover:bg-border/60",
        ghost: "text-muted hover:text-text hover:bg-surface-2",
        danger: "bg-err text-white hover:bg-err/85",
        // kumo-ui flavored variants (classes come from kumo styles.css)
        kumo: "button primary",
        kumoSecondary: "button third !text-text"
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2 text-xs",
        icon: "h-8 w-8"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
)

/* ----------------------------------- card ---------------------------------- */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface shadow-sm", className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-0.5 px-4 py-3", className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-[13px] font-semibold tracking-wide text-muted uppercase", className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />
}

/* ---------------------------------- badge ---------------------------------- */

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 border",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-muted border-border",
        ok: "bg-ok/10 text-ok border-ok/30",
        warn: "bg-warn/10 text-warn border-warn/30",
        err: "bg-err/10 text-err border-err/30",
        info: "bg-info/10 text-info border-info/30",
        accent: "bg-accent/10 text-accent border-accent/30"
      }
    },
    defaultVariants: { tone: "neutral" }
  }
)

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export type StatusTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>

/* ---------------------------------- input ---------------------------------- */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-border bg-bg px-2.5 text-[13px] text-text placeholder:text-muted/60 focus:border-accent focus:outline-none",
        className
      )}
      {...props}
    />
  )
)

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-8 rounded-md border border-border bg-bg px-2 text-[13px] text-text focus:border-accent focus:outline-none cursor-pointer",
      className
    )}
    {...props}
  />
))

/* ---------------------------------- table ---------------------------------- */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full caption-bottom text-[13px]", className)} {...props} />
    </div>
  )
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("[&_tr]:border-b [&_tr]:border-border [&_th]:text-muted", className)}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-border/60 transition-colors hover:bg-surface-2/60", className)}
      {...props}
    />
  )
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("h-9 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wide", className)}
      {...props}
    />
  )
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />
}

/* --------------------------------- spinner --------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("spinner-small inline-block", className)} />
}
