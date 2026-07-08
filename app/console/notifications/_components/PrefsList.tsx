import { labelForType } from "@/components/notifications/types";
import { TOGGLEABLE_TYPES } from "./constants";

interface PrefsListProps {
  prefsError: string | null;
  savingPref: string | null;
  isEnabled: (type: string) => boolean;
  onTogglePref: (type: string) => void;
}

// The list of per-type delivery toggles. Pure presentation — state lives in the
// usePrefs hook so this can be reused inline and on the preferences sub-page.
export function PrefsList({
  prefsError,
  savingPref,
  isEnabled,
  onTogglePref,
}: PrefsListProps) {
  return (
    <div className="p-5">
      <p className="text-xs text-ink/40 mb-3">
        Choose which activity sends you an in-app notification.
      </p>
      {prefsError ? (
        <p className="mb-3 text-sm text-red-600">{prefsError}</p>
      ) : null}
      <ul className="divide-y divide-ink/10">
        {TOGGLEABLE_TYPES.map((type) => (
          <li key={type} className="py-2.5 flex items-center justify-between">
            <span className="text-sm text-ink/70">{labelForType(type)}</span>
            <button
              onClick={() => onTogglePref(type)}
              disabled={savingPref === type}
              role="switch"
              aria-checked={isEnabled(type)}
              aria-label={`${labelForType(type)} notifications`}
              className={`w-10 h-5 rounded-full transition-colors relative disabled:opacity-50 ${
                isEnabled(type) ? "bg-accent" : "bg-ink/20"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  isEnabled(type) ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
