interface PermalinkButtonProps {
  copied: boolean;
  onCopy: () => void;
}

export function PermalinkButton({ copied, onCopy }: PermalinkButtonProps) {
  return (
    <div className="mb-4">
      <button
        onClick={onCopy}
        className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
      >
        {copied ? "Permalink copied ✓" : "Copy permalink"}
      </button>
    </div>
  );
}
