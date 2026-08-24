/**
 * Adapter layer between cluster-ui pages and the vendored kamo…kumo design
 * system (web/src/kumo). Pages should migrate to importing kumo components
 * directly; this file exists so the migration can happen incrementally.
 *
 * Every mapping below is logic-only (variant/name translation) — all styling
 * comes from kumo itself.
 */
import * as React from "react"
import {
  Badge as KumoBadge,
  Button as KumoButton,
  Input as KumoInput,
  Table as KumoTable,
  cn,
  inputVariants,
  type BadgeVariant,
} from "../kumo"

export function cn_(...args: Parameters<typeof cn>) {
  return cn(...args)
}
export { cn }

/* ---------------------------------- button --------------------------------- */

type LegacyVariant = "default" | "secondary" | "ghost" | "danger" | "kumo" | "kumoSecondary"
type LegacySize = "default" | "sm" | "icon"

const VARIANT_MAP: Record<LegacyVariant, string> = {
  default: "primary",
  secondary: "secondary",
  ghost: "ghost",
  danger: "destructive",
  kumo: "primary",
  kumoSecondary: "secondary"
}

const SIZE_MAP: Record<LegacySize, string | undefined> = {
  default: "sm",
  sm: "xs",
  icon: undefined // icon buttons are a separate prop shape in kumo; size via class
}

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: LegacyVariant
  size?: LegacySize
  className?: string
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "default", className, ...props }, ref) => {
    const kumoVariant = VARIANT_MAP[variant] as never
    const kumoSize = SIZE_MAP[size] as never
    const kumoProps = {
      ref,
      variant: kumoVariant,
      ...(kumoSize ? { size: kumoSize } : {}),
      className: cn(size === "icon" && "w-8 px-0", className),
      ...props
    } as never
    return <KumoButton {...(kumoProps as any)} />
  }
)
Button.displayName = "Button"

/* ----------------------------------- card ---------------------------------- */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-kumo-line bg-kumo-base", className)} {...props} />
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-0.5 px-4 py-3", className)} {...props} />
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-[11px] font-semibold tracking-wide text-kumo-subtle uppercase", className)} {...props} />
  )
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />
}

/* ---------------------------------- badge ---------------------------------- */

export type StatusTone = "neutral" | "ok" | "warn" | "err" | "info" | "accent"

const TONE_TO_BADGE: Record<StatusTone, BadgeVariant> = {
  neutral: "secondary",
  ok: "success",
  warn: "warning",
  err: "error",
  info: "info",
  accent: "info"
}

export function Badge({
  tone,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> & { tone?: StatusTone }) {
  const rest = props as Record<string, unknown>
  return <KumoBadge {...(rest as any)} variant={TONE_TO_BADGE[tone ?? "neutral"]} className={className} />
}

/* ---------------------------------- input ---------------------------------- */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const kumoProps = { ref, className: cn(className), ...props } as Record<string, unknown>
    return <KumoInput {...(kumoProps as any)} />
  }
)
Input.displayName = "Input"

/** Native select styled with kumo's input tokens; migrate to kumo Select where
 *  the Base UI API (items/value) is worth it. */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(inputVariants(), "h-8 cursor-pointer pr-6", className)} {...props} />
))
Select.displayName = "Select"

/* ---------------------------------- table ---------------------------------- */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <KumoTable {...({ className, ...props } as any)} />
    </div>
  )
}
export const THead = KumoTable.Header as unknown as React.FC<React.HTMLAttributes<HTMLTableSectionElement>>
export const TBody = KumoTable.Body as unknown as React.FC<React.HTMLAttributes<HTMLTableSectionElement>>
export const TR = KumoTable.Row as unknown as React.FC<React.HTMLAttributes<HTMLTableRowElement>>
export const TH = KumoTable.Head as unknown as React.FC<React.ThHTMLAttributes<HTMLTableCellElement>>
export const TD = KumoTable.Cell as unknown as React.FC<React.TdHTMLAttributes<HTMLTableCellElement>>

/* --------------------------------- spinner --------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-kumo-line border-t-kumo-brand",
        className
      )}
    />
  )
}
