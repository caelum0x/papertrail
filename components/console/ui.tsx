// Console UI primitive kit — the single shared source for the console's Skeleton,
// Card, Badge, Button, StatCard, and EmptyState. Every page uses the same house
// tokens (ink / paper / accent) through these instead of re-implementing the same
// Tailwind strings inline, so the console reads as one system.
//
// Presentational only — no data flow, no client hooks. Safe to use from server or
// client components.

import Link from "next/link";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Skeleton — animated shimmer placeholder shown while real data loads. Replaces
// plain "Loading…" text with a shape that hints at the content to come.
// ---------------------------------------------------------------------------
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden rounded bg-ink/10 ${className}`}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </span>
  );
}

// A stack of skeleton text lines; the last line is shortened like real prose.
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="block space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card — the standard white console panel. Centralizes the shell every page
// was copy-pasting (rounded-lg border border-ink/15 bg-white).
// ---------------------------------------------------------------------------
export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-ink/15 bg-white ${
        padded ? "p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge — a small status pill. Tones map to the house semantic colors.
// ---------------------------------------------------------------------------
type BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink/5 text-ink/60",
  accent: "bg-accent/10 text-accent",
  success: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Button — primary / secondary / ghost. Renders an <a> (via next/link) when
// `href` is given, otherwise a <button>. Centralizes the accent button style.
// ---------------------------------------------------------------------------
type ButtonVariant = "primary" | "secondary" | "ghost";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent/90",
  secondary: "border border-ink/15 bg-white text-ink/70 hover:border-ink/30",
  ghost: "text-ink/60 hover:text-ink/90",
};

interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}

export function Button({
  children,
  variant = "primary",
  href,
  onClick,
  type = "button",
  disabled = false,
  className = "",
}: ButtonProps) {
  const base = `inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={base}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={base}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// StatCard — a labeled metric with an optional hint. Renders a skeleton while
// `loading` so the overview never flashes a bare "—" or 0.
// ---------------------------------------------------------------------------
export function StatCard({
  label,
  value,
  hint,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <div className="text-sm text-ink/40">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <div className="mt-2 text-3xl font-semibold text-ink/80">{value}</div>
      )}
      {hint ? <div className="mt-1 text-xs text-ink/40">{hint}</div> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — the dashed-border "nothing here yet" panel, with an optional
// call-to-action. Reused so first-run screens feel finished, not blank.
// ---------------------------------------------------------------------------
export function EmptyState({
  title,
  message,
  actionLabel,
  actionHref,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-ink/20 bg-white/50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink/70">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink/45">{message}</p>
      {actionLabel && actionHref ? (
        <div className="mt-4">
          <Button href={actionHref} variant="secondary">
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
