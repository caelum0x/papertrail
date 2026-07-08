"use client";

interface SearchBarProps {
  value: string;
  activeSearch: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClear: () => void;
}

// Title search form with an optional clear button when a search is active.
export function SearchBar({
  value,
  activeSearch,
  onChange,
  onSubmit,
  onClear,
}: SearchBarProps) {
  return (
    <form onSubmit={onSubmit} className="mt-6 flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by title..."
        className="flex-1 text-sm border border-ink/15 rounded px-3 py-2 bg-white focus:outline-none focus:border-accent"
      />
      <button
        type="submit"
        className="text-sm border border-ink/15 rounded px-3 py-2 hover:border-accent"
      >
        Search
      </button>
      {activeSearch ? (
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-ink/50 hover:text-ink/80"
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}
