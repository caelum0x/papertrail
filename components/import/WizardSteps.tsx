// Horizontal step indicator for the import wizard. Purely presentational.

export const WIZARD_STEPS = ["Upload", "Map", "Preview", "Commit"] as const;
export type WizardStepIndex = 0 | 1 | 2 | 3;

export function WizardSteps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {WIZARD_STEPS.map((label, idx) => {
        const state =
          idx < current ? "done" : idx === current ? "active" : "todo";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium " +
                (state === "active"
                  ? "bg-accent text-white"
                  : state === "done"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-paper text-ink/40 border border-ink/10")
              }
            >
              {idx + 1}
            </span>
            <span
              className={
                state === "active" ? "text-ink/80 font-medium" : "text-ink/40"
              }
            >
              {label}
            </span>
            {idx < WIZARD_STEPS.length - 1 ? (
              <span className="mx-1 h-px w-6 bg-ink/10" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
