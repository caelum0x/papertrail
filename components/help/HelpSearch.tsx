"use client";

// Search box for the help center landing page. Controlled by the parent page,
// which debounces and refetches the article list. Submitting also triggers an
// immediate search.
import { useState } from "react";

export function HelpSearch({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={`flex items-center gap-2 bg-white border rounded-lg px-3 py-2 ${
        focused ? "border-accent" : "border-ink/10"
      }`}
    >
      <span className="text-ink/40 text-sm" aria-hidden>
        {"⌕"}
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search help articles..."
        className="flex-1 bg-transparent text-sm text-ink/80 outline-none placeholder:text-ink/40"
        aria-label="Search help articles"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            onSubmit();
          }}
          className="text-xs text-ink/40 hover:text-ink/60"
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}
