"use client";

// A thin, accessible progress indicator for the setup wizard. Shows how far
// through the required steps the user is, both as a bar and a fraction.

interface ProgressBarProps {
  percent: number;
  requiredDone: number;
  requiredTotal: number;
}

export function ProgressBar({
  percent,
  requiredDone,
  requiredTotal,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ink/60">
        <span>Setup progress</span>
        <span>
          {requiredDone} of {requiredTotal} required
        </span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-ink/10"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Onboarding progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
