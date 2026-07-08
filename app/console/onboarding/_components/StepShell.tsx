"use client";

import type { ReactNode } from "react";

// Shared frame for every wizard step: a title, blurb, the step's body, and a
// consistent footer with Back / primary-action controls. Keeps the individual
// step components focused on their own content.

interface StepShellProps {
  title: string;
  blurb: string;
  children: ReactNode;
  onBack?: () => void;
  backDisabled?: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  error?: string | null;
}

export function StepShell({
  title,
  blurb,
  children,
  onBack,
  backDisabled,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryBusy,
  secondaryLabel,
  onSecondary,
  error,
}: StepShellProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      <h2 className="text-lg font-medium text-ink/80">{title}</h2>
      <p className="mt-1 text-sm text-ink/60">{blurb}</p>

      <div className="mt-5">{children}</div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <div className="mt-8 flex items-center justify-between border-t border-ink/10 pt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={backDisabled || !onBack}
          className="text-sm text-ink/60 hover:text-ink/80 disabled:opacity-40"
        >
          &larr; Back
        </button>
        <div className="flex items-center gap-3">
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              onClick={onSecondary}
              className="text-sm text-ink/60 hover:text-ink/80"
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onPrimary}
            disabled={primaryDisabled || primaryBusy}
            className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {primaryBusy ? "Working…" : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
